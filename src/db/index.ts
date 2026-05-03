import { Pool, PoolClient } from 'pg';
import { config } from '../config/index.js';

let pool: Pool;

export function initializePool(): Pool {
  pool = new Pool({
    connectionString: config.database.url,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializePool first.');
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

// Helper function to run queries
export async function query<T>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await getClient();
  try {
    const result = await client.query<T>(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// Helper function to run a single row query
export async function queryOne<T>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const results = await query<T>(text, params);
  return results.length > 0 ? results[0] : null;
}

// Test connection
export async function testConnection(): Promise<boolean> {
  try {
    const client = await getClient();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}
