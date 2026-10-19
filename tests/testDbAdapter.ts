import Database from 'better-sqlite3';
import { DatabaseClient, setCustomDatabaseFactory } from '../src/db/database';
import { SCHEMA_SQL } from '../src/db/schema';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const trackedDatabases: Database.Database[] = [];
let activeTempDb: string | null = null;

export function createTestDb(dbPath: string = ':memory:'): DatabaseClient {
  const db = new Database(dbPath);
  trackedDatabases.push(db);

  const client: DatabaseClient = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, params: any[] = []) {
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      return {
        lastInsertRowId: Number(info.lastInsertRowid),
        changes: info.changes,
      };
    },
    async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
      const stmt = db.prepare(sql);
      const row = stmt.get(...params);
      return (row as T) || null;
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      db.exec('BEGIN;');
      try {
        await fn();
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    async closeAsync() {
      const idx = trackedDatabases.indexOf(db);
      if (idx !== -1) trackedDatabases.splice(idx, 1);
      try {
        db.close();
      } catch {}
    },
  };

  return client;
}

export function cleanupTestEnvironment() {
  while (trackedDatabases.length > 0) {
    const db = trackedDatabases.pop();
    try {
      db?.close();
    } catch {}
  }
  if (activeTempDb && fs.existsSync(activeTempDb)) {
    try {
      fs.unlinkSync(activeTempDb);
    } catch {}
    activeTempDb = null;
  }
  setCustomDatabaseFactory(null);
}

export function setupTestEnvironment() {
  cleanupTestEnvironment();
  activeTempDb = path.join(
    os.tmpdir(),
    `kantahulay-test-${Date.now()}-${Math.random().toString(36).substring(7)}.db`
  );
  setCustomDatabaseFactory(async () => createTestDb(activeTempDb!));
  return createTestDb(activeTempDb!);
}

