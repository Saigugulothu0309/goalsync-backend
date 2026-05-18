const fs = require('fs');
const path = require('path');
const files = {
  "src/config/db.js": "const { Pool } = require('pg');\n\nconst connectionString = process.env.DATABASE_URL;\n\nconst pool = new Pool(\n  connectionString\n    ? {\n        connectionString,\n        ssl: { rejectUnauthorized: false },\n      }\n    : {\n        host: process.env.DB_HOST || 'localhost',\n        port: process.env.DB_PORT || 5432,\n        database: process.env.DB_NAME || 'atomquest',\n        user: process.env.DB_USER || 'postgres',\n        password: process.env.DB_PASSWORD || 'postgres',\n        max: 20,\n        idleTimeoutMillis: 30000,\n        connectionTimeoutMillis: 2000,\n      }\n);\n\npool.on('error', (err) => {\n  console.error('Unexpected PostgreSQL client error', err);\n});\n\nconst query = (text, params) => pool.query(text, params);\n\nconst getClient = () => pool.connect();\n\nconst withTransaction = async (callback) => {\n  const client = await pool.connect();\n  try {\n    await client.query('BEGIN');\n    const result = await callback(client);\n    await client.query('COMMIT');\n    return result;\n  } catch (err) {\n    await client.query('ROLLBACK');\n    throw err;\n  } finally {\n    client.release();\n  }\n};\n\nmodule.exports = { query, getClient, withTransaction, pool };\n"
};
for (const [relPath, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(process.cwd(), relPath)), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), relPath), content, 'utf8');
  console.log('updated:', relPath);
}
console.log('Done! Now: git add . && git commit -m "fix: ssl for neon db" && git push');
