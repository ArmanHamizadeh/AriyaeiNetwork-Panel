/**
 * AriyaeiNetwork — Node Deployment Engine
 * Creator: Armin Hamizadeh (آرمین حامی‌زاده)
 *
 * One-click SSH automation for provisioning tunnel/relay software on remote
 * nodes: Gost, Rathole, Backhaul, Hysteria2, 6to4 relays, plus BBR kernel
 * tuning and Cloudflare Warp outbound routing.
 *
 * Design notes:
 *  - SSH private keys are NEVER stored in Postgres. Node.sshKeyRef is a
 *    reference resolved through resolveSshKey() (env-backed here; swap in a
 *    real secrets manager such as Vault/AWS Secrets Manager in production).
 *  - Every deployment is recorded as a DeploymentJob row so failures are
 *    auditable and retryable.
 */

import { NodeSSH } from "node-ssh";
import { PrismaClient, DeploymentJobType, DeploymentJobStatus, Node } from "@prisma/client";
import fs from "node:fs/promises";

const prisma = new PrismaClient();

// ------------------------------------------------------------------
// Secret resolution (swap this out for Vault/AWS Secrets Manager/etc.)
// ------------------------------------------------------------------
async function resolveSshKey(sshKeyRef: string): Promise<string> {
  // Convention: sshKeyRef is a path under a mounted secrets volume, e.g.
  // "/run/secrets/ariyaei/nodes/<id>.pem"
  return fs.readFile(sshKeyRef, "utf-8");
}

async function connect(node: Node): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  const privateKey = await resolveSshKey(node.sshKeyRef);
  await ssh.connect({
    host: node.host,
    port: node.sshPort,
    username: node.sshUser,
    privateKey,
    readyTimeout: 20000,
  });
  return ssh;
}

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function runScript(ssh: NodeSSH, script: string, label: string): Promise<ExecResult> {
  const remotePath = `/tmp/ariyaei_${label}_${Date.now()}.sh`;
  await ssh.execCommand(
    `cat <<'ARIYAEI_EOF' > ${remotePath}\n${script}\nARIYAEI_EOF\nchmod +x ${remotePath}`
  );
  const result = await ssh.execCommand(`bash ${remotePath}`);
  await ssh.execCommand(`rm -f ${remotePath}`);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}

async function recordJob(
  nodeId: string,
  type: DeploymentJobType,
  fn: (ssh: NodeSSH) => Promise<ExecResult>
): Promise<void> {
  const job = await prisma.deploymentJob.create({
    data: { nodeId, type, status: DeploymentJobStatus.RUNNING, startedAt: new Date() },
  });

  const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
  let ssh: NodeSSH | null = null;

  try {
    ssh = await connect(node);
    const result = await fn(ssh);

    await prisma.deploymentJob.update({
      where: { id: job.id },
      data: {
        status: result.ok ? DeploymentJobStatus.SUCCESS : DeploymentJobStatus.FAILED,
        logOutput: result.stdout,
        errorOutput: result.ok ? null : result.stderr,
        finishedAt: new Date(),
      },
    });

    if (!result.ok) {
      throw new Error(`Deployment job ${type} failed on node ${node.name}: ${result.stderr}`);
    }
  } catch (err: any) {
    await prisma.deploymentJob.update({
      where: { id: job.id },
      data: {
        status: DeploymentJobStatus.FAILED,
        errorOutput: String(err?.message ?? err),
        finishedAt: new Date(),
      },
    });
    throw err;
  } finally {
    ssh?.dispose();
  }
}

// ------------------------------------------------------------------
// Provisioning scripts
// ------------------------------------------------------------------

const SCRIPT_INSTALL_GOST = `
set -e
ARCH=$(uname -m)
VERSION="3.0.0"
curl -fsSL -o /tmp/gost.tar.gz "https://github.com/go-gost/gost/releases/download/v\${VERSION}/gost_\${VERSION}_linux_\${ARCH}.tar.gz"
tar -xzf /tmp/gost.tar.gz -C /usr/local/bin gost
chmod +x /usr/local/bin/gost
cat <<'UNIT' > /etc/systemd/system/ariyaei-gost.service
[Unit]
Description=AriyaeiNetwork Gost Tunnel
After=network.target
[Service]
ExecStart=/usr/local/bin/gost -L=relay+tls://:8443
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ariyaei-gost
echo "GOST_INSTALLED_OK"
`;

const SCRIPT_INSTALL_RATHOLE = (tomlConfig: string) => `
set -e
curl -fsSL -o /tmp/rathole.zip "https://github.com/rapiz1/rathole/releases/latest/download/rathole-x86_64-unknown-linux-gnu.zip"
unzip -o /tmp/rathole.zip -d /usr/local/bin
chmod +x /usr/local/bin/rathole
mkdir -p /etc/ariyaei
cat <<'CFG' > /etc/ariyaei/rathole.toml
${tomlConfig}
CFG
cat <<'UNIT' > /etc/systemd/system/ariyaei-rathole.service
[Unit]
Description=AriyaeiNetwork Rathole Tunnel
After=network.target
[Service]
ExecStart=/usr/local/bin/rathole /etc/ariyaei/rathole.toml
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ariyaei-rathole
echo "RATHOLE_INSTALLED_OK"
`;

const SCRIPT_INSTALL_BACKHAUL = (config: string) => `
set -e
curl -fsSL -o /tmp/backhaul.tar.gz "https://github.com/Musixal/Backhaul/releases/latest/download/backhaul_linux_amd64.tar.gz"
tar -xzf /tmp/backhaul.tar.gz -C /usr/local/bin backhaul
chmod +x /usr/local/bin/backhaul
mkdir -p /etc/ariyaei
cat <<'CFG' > /etc/ariyaei/backhaul.toml
${config}
CFG
cat <<'UNIT' > /etc/systemd/system/ariyaei-backhaul.service
[Unit]
Description=AriyaeiNetwork Backhaul Tunnel
After=network.target
[Service]
ExecStart=/usr/local/bin/backhaul -c /etc/ariyaei/backhaul.toml
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ariyaei-backhaul
echo "BACKHAUL_INSTALLED_OK"
`;

const SCRIPT_INSTALL_HYSTERIA2 = (port: number, password: string) => `
set -e
bash <(curl -fsSL https://get.hy2.sh/)
mkdir -p /etc/hysteria
cat <<CFG > /etc/hysteria/config.yaml
listen: :${port}
auth:
  type: password
  password: "${password}"
masquerade:
  type: proxy
  proxy:
    url: https://www.bing.com
    rewriteHost: true
CFG
systemctl enable --now hysteria-server.service
echo "HYSTERIA2_INSTALLED_OK"
`;

const SCRIPT_SETUP_6TO4 = `
set -e
modprobe sit
ip tunnel add ariyaei6to4 mode sit remote any local $(hostname -I | awk '{print $1}')
ip link set ariyaei6to4 up
ip addr add 192.88.99.1/24 dev ariyaei6to4
echo 1 > /proc/sys/net/ipv4/ip_forward
echo "SIXTOFOUR_CONFIGURED_OK"
`;

const SCRIPT_APPLY_BBR = `
set -e
CURRENT_KERNEL=$(uname -r | cut -d. -f1,2)
modprobe tcp_bbr || true
echo "tcp_bbr" >> /etc/modules-load.d/modules.conf
cat <<SYSCTL >> /etc/sysctl.conf
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.core.rmem_max=67108864
net.core.wmem_max=67108864
net.ipv4.tcp_rmem=4096 87380 67108864
net.ipv4.tcp_wmem=4096 65536 67108864
net.ipv4.tcp_fastopen=3
net.ipv4.tcp_mtu_probing=1
SYSCTL
sysctl -p
CONGESTION=$(sysctl net.ipv4.tcp_congestion_control | awk '{print $3}')
if [ "\$CONGESTION" = "bbr" ]; then
  echo "BBR_APPLIED_OK"
else
  echo "BBR_APPLY_FAILED" >&2
  exit 1
fi
`;

const SCRIPT_CLOUDFLARE_WARP = (licenseKey?: string) => `
set -e
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/cloudflare-client.list
apt-get update -y && apt-get install -y cloudflare-warp
warp-cli --accept-tos registration new
${licenseKey ? `warp-cli --accept-tos registration license "${licenseKey}"` : ""}
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect
echo "WARP_CONNECTED_OK"
`;

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export async function deployGost(nodeId: string): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.INSTALL_GOST, (ssh) =>
    runScript(ssh, SCRIPT_INSTALL_GOST, "gost")
  );
}

export async function deployRathole(nodeId: string, tomlConfig: string): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.INSTALL_RATHOLE, (ssh) =>
    runScript(ssh, SCRIPT_INSTALL_RATHOLE(tomlConfig), "rathole")
  );
}

export async function deployBackhaul(nodeId: string, config: string): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.INSTALL_BACKHAUL, (ssh) =>
    runScript(ssh, SCRIPT_INSTALL_BACKHAUL(config), "backhaul")
  );
}

export async function deployHysteria2(
  nodeId: string,
  opts: { port: number; password: string }
): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.INSTALL_HYSTERIA2, (ssh) =>
    runScript(ssh, SCRIPT_INSTALL_HYSTERIA2(opts.port, opts.password), "hysteria2")
  );
}

export async function deploy6to4(nodeId: string): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.SETUP_6TO4, (ssh) =>
    runScript(ssh, SCRIPT_SETUP_6TO4, "sixtofour")
  );
}

export async function applyBbrTuning(nodeId: string): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.APPLY_BBR, (ssh) =>
    runScript(ssh, SCRIPT_APPLY_BBR, "bbr")
  );
  await prisma.node.update({ where: { id: nodeId }, data: { bbrEnabled: true } });
}

export async function deployCloudflareWarp(nodeId: string, licenseKey?: string): Promise<void> {
  await recordJob(nodeId, DeploymentJobType.APPLY_CLOUDFLARE_WARP, (ssh) =>
    runScript(ssh, SCRIPT_CLOUDFLARE_WARP(licenseKey), "warp")
  );
  await prisma.node.update({ where: { id: nodeId }, data: { warpEnabled: true } });
}

/**
 * Convenience orchestrator used by the "one-click deploy" API endpoint —
 * runs BBR tuning first (it's cheap and safe), then the requested tunnel
 * protocol, so every fresh node gets baseline kernel tuning by default.
 */
export async function oneClickDeploy(
  nodeId: string,
  protocol: "gost" | "rathole" | "backhaul" | "hysteria2" | "6to4",
  options: Record<string, any> = {}
): Promise<void> {
  await applyBbrTuning(nodeId);

  switch (protocol) {
    case "gost":
      return deployGost(nodeId);
    case "rathole":
      return deployRathole(nodeId, options.tomlConfig);
    case "backhaul":
      return deployBackhaul(nodeId, options.config);
    case "hysteria2":
      return deployHysteria2(nodeId, { port: options.port, password: options.password });
    case "6to4":
      return deploy6to4(nodeId);
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
}
