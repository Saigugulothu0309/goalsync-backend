const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME || 'atomquest', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres' }
);

pool.on('error', (err) => { console.error('PostgreSQL error', err); });

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();
const withTransaction = async (cb) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const r = await cb(client); await client.query('COMMIT'); return r; }
  catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
};

module.exports = { query, getClient, withTransaction, pool };