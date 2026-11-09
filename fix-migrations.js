/**
 * One-time fix: marks migration 1 as complete in the Knex tracking table
 * so that migration 2 can run. Run when the schema was created manually
 * (or by a previous migration attempt) but Knex has no record of it.
 *
 *   node fix-migrations.js
 */
require('dotenv').config()
const mysql = require('mysql2/promise')

;(async () => {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })

  // Ensure the Knex tracking tables exist
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`knex_migrations\` (
      \`id\` int unsigned NOT NULL AUTO_INCREMENT,
      \`name\` varchar(255) DEFAULT NULL,
      \`batch\` int DEFAULT NULL,
      \`migration_time\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`knex_migrations_lock\` (
      \`index\` int unsigned NOT NULL AUTO_INCREMENT,
      \`is_locked\` int DEFAULT NULL,
      PRIMARY KEY (\`index\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Seed the lock row if missing
  const [lockRows] = await conn.query('SELECT * FROM `knex_migrations_lock` WHERE `index` = 1')
  if (!lockRows.length) {
    await conn.execute("INSERT INTO `knex_migrations_lock` (`is_locked`) VALUES (0)")
    console.log('Created migration lock row')
  }

  // Mark migration 1 as complete if not already recorded
  const [existing] = await conn.query(
    "SELECT id FROM `knex_migrations` WHERE name = '20260101000001_create_schema.js'"
  )
  if (!existing.length) {
    await conn.execute(
      "INSERT INTO `knex_migrations` (name, batch) VALUES ('20260101000001_create_schema.js', 1)"
    )
    console.log('✓ Migration 1 marked as complete')
  } else {
    console.log('Migration 1 was already recorded — nothing to do')
  }

  await conn.end()
  console.log('Done. Now run: node_modules\\.bin\\knex migrate:latest')
})().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
