# Build context = repo ROOT (shares the pnpm workspace with the rest of the project).
#   docker build -f account/Dockerfile -t skillgrade-account .
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 8080
ENV PORT=8080
# Apply Drizzle migrations on boot, then serve. A failed migration aborts start (fail loud).
CMD ["sh", "-c", "pnpm drizzle-kit migrate && pnpm account"]
