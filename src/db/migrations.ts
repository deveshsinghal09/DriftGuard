import type { Database } from 'better-sqlite3';

const applicationId = 0x44524744; // DRGD

const migrations = [
  {
    version: 1,
    name: 'identify_driftguard_database',
    sql: `PRAGMA application_id = ${applicationId}`,
  },
];

type MigrationRecord = { version: number; name: string };

export function migrateDatabase(db: Database): void {
  db.transaction(() => {
    const storedApplicationId = db.pragma('application_id', { simple: true });
    if (storedApplicationId === 0) {
      const existingObject = db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1").get();
      if (existingObject) throw new Error('Refusing to initialize a non-empty SQLite database');

      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) STRICT
      `);
    } else if (storedApplicationId !== applicationId) {
      throw new Error('SQLite database belongs to another application');
    }

    const applied = db.prepare<[], MigrationRecord>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    ).all();
    if (applied.some(({ version, name }, index) =>
      version !== migrations[index]?.version || name !== migrations[index]?.name,
    )) {
      throw new Error('SQLite migration history does not match this DriftGuard build');
    }

    const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
    for (const migration of migrations.slice(applied.length)) {
      db.exec(migration.sql);
      record.run(migration.version, migration.name);
    }
  }).immediate();
}

export function assertDatabaseReady(db: Database): void {
  const row = db.prepare<[], { version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_migrations',
  ).get();
  if (!row || row.version !== migrations.at(-1)?.version) {
    throw new Error('SQLite schema is not current');
  }
}
