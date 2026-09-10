FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib ./lib
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @workspace/db exec prisma generate --schema ./prisma/schema.prisma
RUN pnpm --filter @workspace/api run build
ENV PORT=4000
EXPOSE 4000
CMD ["node", "lib/api/dist/index.js"]

