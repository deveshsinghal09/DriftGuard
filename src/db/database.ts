import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrateDatabase } from './migrations.js';

export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
