import { SCHEMA_SQL } from './schema';

export interface DatabaseClient {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: any[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: any[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

let primaryDb: DatabaseClient | null = null;
let primaryDbPromise: Promise<DatabaseClient> | null = null;
let customDbFactory: (() => Promise<DatabaseClient>) | null = null;

export function setCustomDatabaseFactory(factory: (() => Promise<DatabaseClient>) | null) {
  customDbFactory = factory;
  primaryDb = null;
  primaryDbPromise = null;
}

export async function openDedicatedConnectionAsync(): Promise<DatabaseClient> {
  if (customDbFactory) {
    return await customDbFactory();
  }
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync('kantahulay.db', { useNewConnection: true });
  return db as unknown as DatabaseClient;
}

async function createResilientPrimaryDb(): Promise<DatabaseClient> {
  let rawDb = await openDedicatedConnectionAsync();
  await initSchemaAsync(rawDb);

  const resetConnection = async (): Promise<DatabaseClient> => {
    try {
      await rawDb.closeAsync();
    } catch {}
    rawDb = await openDedicatedConnectionAsync();
    await initSchemaAsync(rawDb);
    return rawDb;
  };

  const isNpeError = (err: any): boolean => {
    const msg = String(err?.message || err || '');
    return msg.includes('NullPointerException');
  };

  async function withRetry<T>(operation: (db: DatabaseClient) => Promise<T>): Promise<T> {
    try {
      return await operation(rawDb);
    } catch (err: any) {
      if (isNpeError(err)) {
        await resetConnection();
        return await operation(rawDb);
      }
      throw err;
    }
  }

  return {
    async execAsync(sql: string) {
      return withRetry((db) => db.execAsync(sql));
    },
    async runAsync(sql: string, params?: any[]) {
      return withRetry((db) => db.runAsync(sql, params));
    },
    async getAllAsync<T>(sql: string, params?: any[]) {
      return withRetry((db) => db.getAllAsync<T>(sql, params));
    },
    async getFirstAsync<T>(sql: string, params?: any[]) {
      return withRetry((db) => db.getFirstAsync<T>(sql, params));
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      return withRetry((db) => db.withTransactionAsync(fn));
    },
    async closeAsync() {
      primaryDb = null;
      primaryDbPromise = null;
      return rawDb.closeAsync();
    },
  };
}

export async function getDatabaseAsync(): Promise<DatabaseClient> {
  if (primaryDb) {
    return primaryDb;
  }
  if (!primaryDbPromise) {
    primaryDbPromise = createResilientPrimaryDb()
      .then((db) => {
        primaryDb = db;
        primaryDbPromise = null;
        return db;
      })
      .catch((err) => {
        primaryDb = null;
        primaryDbPromise = null;
        throw err;
      });
  }
  return await primaryDbPromise;
}

export async function initSchemaAsync(db: DatabaseClient): Promise<void> {
  await db.execAsync(SCHEMA_SQL);
  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN onboarding_completed INTEGER DEFAULT 0;');
  } catch {
    // Column already exists or table freshly created
  }
  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN bluetooth_lyric_offset_ms INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN vocal_effects_level INTEGER NOT NULL DEFAULT 1;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN music_volume REAL NOT NULL DEFAULT 1.0;');
  } catch {}
}
