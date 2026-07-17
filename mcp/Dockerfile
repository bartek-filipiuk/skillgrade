# Build context = repo ROOT (so hub/catalog.json and the whole project are present).
#   docker build -f mcp/Dockerfile -t skillgrade-mcp .
FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["pnpm", "mcp"]
