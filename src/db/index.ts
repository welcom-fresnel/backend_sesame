import { Pool, PoolClient } from 'pg';
import { config } from '../config/index.js';

let pool: Pool;

export function initializePool(): Pool {
  const connStr = config.database.url || '';
  // Mask password when logging
  const masked = connStr.replace(/:(?:[^:@]+)@/, ':****@');
  console.log('Using DATABASE_URL:', masked);

  pool = new Pool({
    connectionString: connStr,
    idleTimeoutMillis: 30000,
    // Increase the connection timeout to allow for slower startups or transient network hiccups
    connectionTimeoutMillis: 10000,
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
  const maxRetries = 5;
  const baseDelay = 1000; // ms

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await getClient();
      await client.query('SELECT NOW()');
      client.release();
      console.log('✅ Database connection successful');
      return true;
    } catch (error) {
      const cause = (error as any).cause ?? error;
      console.error(
        `❌ Database connection attempt ${attempt}/${maxRetries} failed:`,
        cause
      );

      if (attempt < maxRetries) {
        const delay = baseDelay * attempt;
        console.log(`Retrying in ${delay}ms...`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }

  console.error('❌ All database connection attempts failed');
  return false;
}
