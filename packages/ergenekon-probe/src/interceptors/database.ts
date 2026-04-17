// ============================================================================
// ERGENEKON PROBE — Database Interceptors
//
// Monkey-patches popular database drivers to capture queries and results.
// Supports: pg (PostgreSQL), ioredis (Redis), mongoose (MongoDB)
//
// Strategy: Intercept at the driver prototype level so ALL queries
// from ALL connection instances are captured automatically.
// No user code changes required.
// ============================================================================

import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from '../internal-clock.js';
import { redactDeep } from '../redaction.js';

// ── Type stubs (avoids hard dependency on pg/ioredis/mongoose) ────

interface PgClient {
  query: (...args: unknown[]) => unknown;
}

interface PgPool {
  query: (...args: unknown[]) => unknown;
}

interface IoRedisInstance {
  sendCommand: (...args: unknown[]) => unknown;
}

interface MongoCollection {
  find: (...args: unknown[]) => unknown;
  findOne: (...args: unknown[]) => unknown;
  insertOne: (...args: unknown[]) => unknown;
  insertMany: (...args: unknown[]) => unknown;
  updateOne: (...args: unknown[]) => unknown;
  updateMany: (...args: unknown[]) => unknown;
  deleteOne: (...args: unknown[]) => unknown;
  deleteMany: (...args: unknown[]) => unknown;
  aggregate: (...args: unknown[]) => unknown;
}

// ── Track originals for uninstall ─────────────────────────────────

const originals = new Map<string, unknown>();
let pgInstalled = false;
let redisInstalled = false;
let mongoInstalled = false;

// ============================================================================
// PostgreSQL (pg) Interceptor
// ============================================================================

/**
 * Intercept PostgreSQL queries via the `pg` module.
 * Patches Client.prototype.query to capture query text, params, and results.
 */
export function installPgInterceptor(): boolean {
  if (pgInstalled) return true;

  let pg: { Client: { prototype: PgClient }; Pool: { prototype: PgPool } };
  try {
    pg = require('pg');
  } catch {
    // pg not installed — skip silently
    return false;
  }

  // Patch Client.prototype.query
  const originalClientQuery = pg.Client.prototype.query;
  originals.set('pg.Client.query', originalClientQuery);

  pg.Client.prototype.query = function patchedQuery(this: PgClient, ...args: unknown[]): unknown {
    const session = getActiveSession();
    if (!session) return originalClientQuery.apply(this, args);

    // Extract query info
    const queryConfig = typeof args[0] === 'string'
      ? { text: args[0], values: args[1] }
      : args[0] as { text: string; values?: unknown[] };

    const queryText = queryConfig?.text ?? String(args[0]);
    const queryValues = queryConfig?.values;

    session.record('db_query', `PG: ${queryText.slice(0, 80)}`, {
      engine: 'postgresql',
      query: queryText,
      values: redactDeep(queryValues ?? null),
    });

    const start = originalDateNow();
    const result = originalClientQuery.apply(this, args);

    // Handle promise (async queries)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<{ rows: unknown[]; rowCount: number }>).then((res) => {
        const durationMs = originalDateNow() - start;
        session.record('db_result', `PG Result: ${res.rowCount ?? 0} rows`, {
          engine: 'postgresql',
          rows: redactDeep(res.rows),
          rowCount: res.rowCount ?? 0,
        }, { durationMs });
        return res;
      }).catch((err: Error) => {
        const durationMs = originalDateNow() - start;
        session.record('db_result', `PG Error: ${err.message}`, {
          engine: 'postgresql',
          error: { name: err.name, message: err.message },
        }, {
          durationMs,
          error: { name: err.name, message: err.message, stack: err.stack ?? null },
        });
        throw err;
      });
    }

    return result;
  };

  // Patch Pool.prototype.query (same pattern)
  const originalPoolQuery = pg.Pool.prototype.query;
  originals.set('pg.Pool.query', originalPoolQuery);

  pg.Pool.prototype.query = function patchedPoolQuery(this: PgPool, ...args: unknown[]): unknown {
    const session = getActiveSession();
    if (!session) return originalPoolQuery.apply(this, args);

    const queryConfig = typeof args[0] === 'string'
      ? { text: args[0], values: args[1] }
      : args[0] as { text: string; values?: unknown[] };

    const queryText = queryConfig?.text ?? String(args[0]);
    const queryValues = queryConfig?.values;

    session.record('db_query', `PG Pool: ${queryText.slice(0, 80)}`, {
      engine: 'postgresql',
      query: queryText,
      values: redactDeep(queryValues ?? null),
    });

    const start = originalDateNow();
    const result = originalPoolQuery.apply(this, args);

    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<{ rows: unknown[]; rowCount: number }>).then((res) => {
        const durationMs = originalDateNow() - start;
        session.record('db_result', `PG Pool Result: ${res.rowCount ?? 0} rows`, {
          engine: 'postgresql',
          rows: redactDeep(res.rows),
          rowCount: res.rowCount ?? 0,
        }, { durationMs });
        return res;
      }).catch((err: Error) => {
        const durationMs = originalDateNow() - start;
        session.record('db_result', `PG Pool Error: ${err.message}`, {
          engine: 'postgresql',
          error: { name: err.name, message: err.message },
        }, {
          durationMs,
          error: { name: err.name, message: err.message, stack: err.stack ?? null },
        });
        throw err;
      });
    }

    return result;
  };

  pgInstalled = true;
  console.log('[ERGENEKON] PostgreSQL (pg) interceptor installed');
  return true;
}

// ============================================================================
// Redis (ioredis) Interceptor
// ============================================================================

/**
 * Intercept Redis commands via ioredis.
 * Patches sendCommand to capture all Redis operations.
 */
export function installRedisInterceptor(): boolean {
  if (redisInstalled) return true;

  let Redis: { prototype: IoRedisInstance & { sendCommand: (...args: unknown[]) => unknown } };
  try {
    Redis = require('ioredis');
  } catch {
    return false;
  }

  const originalSendCommand = Redis.prototype.sendCommand;
  originals.set('ioredis.sendCommand', originalSendCommand);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Redis.prototype as any).sendCommand = function patchedSendCommand(this: IoRedisInstance, command: { name: string; args: unknown[]; resolve?: (v: unknown) => void; reject?: (e: Error) => void; promise?: Promise<unknown> }, ...rest: unknown[]): unknown {
    const session = getActiveSession();
    if (!session) return originalSendCommand.call(this, command, ...rest);

    const cmdName = command?.name?.toUpperCase() ?? 'UNKNOWN';
    const cmdArgs = command?.args ?? [];

    session.record('cache_get', `REDIS: ${cmdName} ${String(cmdArgs[0] ?? '').slice(0, 60)}`, {
      engine: 'redis',
      command: cmdName,
      args: cmdArgs.map(a => String(a).slice(0, 200)), // Truncate large values
    });

    const start = originalDateNow();
    const result = originalSendCommand.call(this, command, ...rest);

    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).then((res) => {
        const durationMs = originalDateNow() - start;
        session.record('cache_set', `REDIS Result: ${cmdName}`, {
          engine: 'redis',
          command: cmdName,
          result: typeof res === 'string' && res.length > 1000 ? res.slice(0, 1000) + '...' : res,
        }, { durationMs });
        return res;
      }).catch((err: Error) => {
        const durationMs = originalDateNow() - start;
        session.record('cache_set', `REDIS Error: ${cmdName}`, {
          engine: 'redis',
          command: cmdName,
          error: { name: err.name, message: err.message },
        }, {
          durationMs,
          error: { name: err.name, message: err.message, stack: err.stack ?? null },
        });
        throw err;
      });
    }

    return result;
  };

  redisInstalled = true;
  console.log('[ERGENEKON] Redis (ioredis) interceptor installed');
  return true;
}

// ============================================================================
// MongoDB (mongoose/native driver) Interceptor
// ============================================================================

/**
 * Intercept MongoDB operations via mongoose Collection prototype.
 */
export function installMongoInterceptor(): boolean {
  if (mongoInstalled) return true;

  let mongoose: { Collection: { prototype: MongoCollection } };
  try {
    mongoose = require('mongoose');
  } catch {
    return false;
  }

  const methods = [
    'find', 'findOne', 'insertOne', 'insertMany',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'aggregate',
  ] as const;

  for (const method of methods) {
    const original = mongoose.Collection.prototype[method];
    if (!original) continue;

    originals.set(`mongoose.${method}`, original);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mongoose.Collection.prototype as any)[method] = function patchedMongoMethod(this: MongoCollection, ...args: unknown[]): unknown {
      const session = getActiveSession();
      if (!session) return (original as Function).apply(this, args);

      session.record('db_query', `MONGO: ${method}`, {
        engine: 'mongodb',
        operation: method,
        filter: redactDeep(args[0] ?? null),
        options: redactDeep(args[1] ?? null),
      });

      const start = originalDateNow();
      const result = (original as Function).apply(this, args);

      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then((res) => {
          const durationMs = originalDateNow() - start;
          session.record('db_result', `MONGO Result: ${method}`, {
            engine: 'mongodb',
            operation: method,
            result: redactDeep(res),
          }, { durationMs });
          return res;
        });
      }

      return result;
    };
  }

  mongoInstalled = true;
  console.log('[ERGENEKON] MongoDB (mongoose) interceptor installed');
  return true;
}

// ============================================================================
// Uninstall all database interceptors
// ============================================================================

export function uninstallDatabaseInterceptors(): void {
  try {
    if (pgInstalled) {
      const pg = require('pg');
      const origClient = originals.get('pg.Client.query');
      const origPool = originals.get('pg.Pool.query');
      if (origClient) pg.Client.prototype.query = origClient;
      if (origPool) pg.Pool.prototype.query = origPool;
      pgInstalled = false;
    }
  } catch { /* pg not available */ }

  try {
    if (redisInstalled) {
      const Redis = require('ioredis');
      const orig = originals.get('ioredis.sendCommand');
      if (orig) Redis.prototype.sendCommand = orig;
      redisInstalled = false;
    }
  } catch { /* ioredis not available */ }

  try {
    if (mongoInstalled) {
      const mongoose = require('mongoose');
      for (const [key, original] of originals.entries()) {
        if (key.startsWith('mongoose.')) {
          const method = key.split('.')[1];
          if (method) (mongoose.Collection.prototype as Record<string, unknown>)[method] = original;
        }
      }
      mongoInstalled = false;
    }
  } catch { /* mongoose not available */ }

  originals.clear();
}
