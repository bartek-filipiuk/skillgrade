import type { Config } from 'drizzle-kit'
export default {
  schema: './account/db/schema.ts',
  out: './account/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config
