import dns from 'dns';
import net from 'net';
import { Pool, PoolClient, QueryResultRow, type PoolConfig } from 'pg';
import { config } from '../config/index.js';

let pool: Pool;
let keepAliveTimer: NodeJS.Timeout | null = null;

function isHostnameIp(hostname: string) {
  return net.isIP(hostname) !== 0;
}

async function resolveDatabaseHost(hostname: string): Promise<string> {
  if (isHostnameIp(hostname)) {
    return hostname;
  }

  try {
    const addresses = await dns.promises.resolve4(hostname);
    if (addresses.length > 0) {
      return addresses[0];
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      console.warn(`IPv4 lookup failed for ${hostname}:`, err.message || err);
    }
  }

  try {
    const addresses6 = await dns.promises.resolve6(hostname);
    if (addresses6.length > 0) {
      return addresses6[0];
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      console.warn(`IPv6 lookup failed for ${hostname}:`, err.message || err);
    }
  }

  throw new Error(`Could not resolve host ${hostname} to an IPv4 or IPv6 address`);
}

export async function initializePool(): Promise<Pool> {
  const connStr = config.database.url || '';
  // Mask password when logging
  const masked = connStr.replace(/:(?:[^:@]+)@/, ':****@');
  console.log('Using DATABASE_URL:', masked);

  const url = new URL(connStr);
  let resolvedHost = await resolveDatabaseHost(url.hostname);
  if (resolvedHost !== url.hostname) {
    console.log('Resolved DATABASE_URL host to address:', resolvedHost);
  }

  // Try to prefer an IPv4 address when possible (some networks don't have IPv6 connectivity)
  try {
    const lookup4 = await dns.promises.lookup(url.hostname, { family: 4 });
    if (lookup4 && lookup4.address) {
      if (lookup4.address !== resolvedHost) {
        console.log('Found IPv4 address for host, using it instead of resolved host:', lookup4.address);
      }
      // Use the IPv4 address
      // eslint-disable-next-line prefer-const
      (resolvedHost as string) = lookup4.address;
    }
  } catch (err) {
    // If lookup fails, keep the previously resolved host (might be IPv6)
    // This is not fatal; we'll attempt connection and let the pool raise errors if unreachable.
  }

  const poolConfig: PoolConfig = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: resolvedHost,
    port: Number(url.port || 5432),
    database: url.pathname?.slice(1),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };

  const sslMode = url.searchParams.get('sslmode') || process.env.PGSSLMODE;
  if (sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca') {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  try {
    pool = new Pool(poolConfig);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === 'ENETUNREACH') {
      throw new Error(
        `Database host ${resolvedHost} is unreachable. This usually means your machine does not have IPv6 connectivity to reach Supabase. ` +
          'Try a network with IPv6 support or use a Supabase endpoint with IPv4 access.'
      );
    }
    throw error;
  }

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
  stopDatabaseKeepAlive();
  if (pool) {
    await pool.end();
  }
}

export function startDatabaseKeepAlive(intervalMs = Number(process.env.DB_KEEPALIVE_INTERVAL_MS ?? 1000)): void {
  if (keepAliveTimer || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return;
  }

  keepAliveTimer = setInterval(async () => {
    try {
      await getPool().query('SELECT 1');
    } catch (error) {
      console.warn('Database keepalive ping failed:', error);
    }
  }, intervalMs);
}

export function stopDatabaseKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

// Helper function to run queries
export async function query<T extends QueryResultRow>(
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
export async function queryOne<T extends QueryResultRow>(
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
