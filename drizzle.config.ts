import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  strict: true,
  verbose: true,
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
})
