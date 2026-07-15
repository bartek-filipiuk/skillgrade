# Troubleshooting catalog

- `pnpm install` fails on lockfile mismatch → the repo pins a different pnpm
  major; ask the user which version the team uses, do not regenerate the
  lockfile on your own.
- Health check needs a database → look for `docker-compose.yml`; if present,
  ask the user before starting containers.
- Corporate proxy blocks the registry → surface the exact error to the user;
  never switch registries yourself.
