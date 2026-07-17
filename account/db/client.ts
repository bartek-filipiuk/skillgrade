import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

// Lazily constructed so tests never open a connection.
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not set')
    _db = drizzle(postgres(url), { schema })
  }
  return _db
}
export type DB = ReturnType<typeof getDb>
