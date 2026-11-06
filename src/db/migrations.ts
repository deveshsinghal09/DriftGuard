import type { Database } from 'better-sqlite3';

const applicationId = 0x44524744; // DRGD

const migrations = [
  {
    version: 1,
    name: 'identify_driftguard_database',
    sql: `PRAGMA application_id = ${applicationId}`,
  },
  {
    version: 2,
    name: 'store_workflow_tasks_and_handoffs',
    sql: `
      CREATE TABLE workflow_tasks (
        task_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        repository TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_references TEXT NOT NULL CHECK (json_valid(evidence_references)),
        status TEXT NOT NULL CHECK (status IN (
          'proposed', 'assigned', 'ready_for_verification', 'verified', 'changes_requested'
        )),
        candidate_sha TEXT,
        CHECK ((status IN ('proposed', 'assigned')) = (candidate_sha IS NULL))
      ) STRICT;

      CREATE TABLE workflow_handoffs (
        correlation_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES workflow_tasks(task_id),
        revision INTEGER NOT NULL CHECK (revision > 0),
        action TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        envelope TEXT NOT NULL CHECK (json_valid(envelope)),
        UNIQUE (task_id, revision, action)
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: 'register_github_repositories',
    sql: `
      CREATE TABLE github_repositories (
        repository_id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'internal')),
        permission_level TEXT NOT NULL,
        read_enabled INTEGER NOT NULL CHECK (read_enabled IN (0, 1)),
        write_enabled INTEGER NOT NULL CHECK (write_enabled IN (0, 1)),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        added_at TEXT NOT NULL,
        sync_version INTEGER NOT NULL DEFAULT 0,
        CHECK (write_enabled = 0 OR (read_enabled = 1 AND active = 1))
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: 'persist_github_issue_snapshots',
    sql: `
      CREATE TABLE github_issues (
        repository_id INTEGER NOT NULL REFERENCES github_repositories(repository_id),
        github_issue_id INTEGER NOT NULL,
        issue_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        url TEXT NOT NULL,
        author TEXT,
        updated_at TEXT NOT NULL,
        sync_state TEXT NOT NULL CHECK (sync_state IN ('OPEN', 'CLOSED', 'UNAVAILABLE')),
        details TEXT NOT NULL CHECK (json_valid(details)),
        PRIMARY KEY (repository_id, github_issue_id),
        UNIQUE (repository_id, issue_number)
      ) STRICT;
    `,
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
