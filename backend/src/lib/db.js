import pg from 'pg';

const { Pool } = pg;

export const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;

export async function query(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured. Set DATABASE_URL in your environment.');
  }

  return pool.query(text, params);
}

export async function withTransaction(handler) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured. Set DATABASE_URL in your environment.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
