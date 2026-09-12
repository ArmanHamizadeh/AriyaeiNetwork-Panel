# AriyaeiNetwork — Backend Production Dockerfile
# Creator: Armin Hamizadeh (آرمین حامی‌زاده)

FROM node:20-alpine AS builder
WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssh-client curl

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 4000
CMD ["node", "dist/index.js"]
