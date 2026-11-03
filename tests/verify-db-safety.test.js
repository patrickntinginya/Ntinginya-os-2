import assert from 'node:assert/strict'
import test from 'node:test'
import { assertIsolatedDatabaseEnvironment } from '../scripts/verify-db-safety.mjs'

test('database verifier accepts an environment without an external database URL', () => {
  assert.equal(assertIsolatedDatabaseEnvironment({}), true)
  assert.equal(assertIsolatedDatabaseEnvironment({ DATABASE_URL: '  ' }), true)
})

test('database verifier rejects every configured external database URL variable', () => {
  const keys = [
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
  for (const key of keys) {
    assert.throws(
      () => assertIsolatedDatabaseEnvironment({ [key]: 'postgresql://not-used.example/test' }),
      new RegExp(key),
    )
  }
})
