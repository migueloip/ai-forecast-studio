import { pathToFileURL } from 'node:url'
import { query } from './db.js'
import { schemaStatements } from './schema.js'

export async function migrate() {
  for (const statement of schemaStatements) await query(statement)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  migrate()
    .then(() => console.log('Neon schema is up to date.'))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}

