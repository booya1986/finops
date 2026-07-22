import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { DATA_DIR, DB_PATH, DIR_MODE, FILE_MODE } from '../config.js';

/**
 * Open the local financial DB with the hardening from PLAN.md §1.1:
 * data/ at 0700, DB file (and WAL sidecars) at 0600, foreign keys on.
 */
export function openDb(): Database.Database {
  mkdirSync(DATA_DIR, { recursive: true, mode: DIR_MODE });
  chmodSync(DATA_DIR, DIR_MODE); // enforce even if the dir pre-existed

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(path)) chmodSync(path, FILE_MODE);
  }
  return db;
}
