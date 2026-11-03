import { pathToFileURL } from 'node:url'

const DATABASE_URL_KEYS = [
  'PGURL',
  'DATABASE_URL',
  'DB_URL',
  'DIRECT_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'SUPABASE_DB_URL',
  'SUPABASE_DATABASE_URL',
]

export function assertIsolatedDatabaseEnvironment(env = process.env) {
  const configured = DATABASE_URL_KEYS.filter((key) => String(env[key] || '').trim())
  if (configured.length) {
    throw new Error(`External database configuration is not accepted by verify-db.sh (${configured.join(', ')}). The script uses only its own disposable Docker database.`)
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertIsolatedDatabaseEnvironment()
  } catch (error) {
    console.error(`Refusing database validation: ${error.message}`)
    process.exitCode = 2
  }
}
