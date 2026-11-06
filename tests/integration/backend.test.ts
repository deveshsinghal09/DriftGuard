import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app/build-app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { openDatabase } from '../../src/db/database.js';

let directory: string;
let databasePath: string;
let app: ReturnType<typeof buildApp> | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'driftguard-test-'));
  databasePath = join(directory, 'test.sqlite');
});

afterEach(async () => {
  try {
    await app?.close();
  } finally {
    app = undefined;
    rmSync(databasePath, { force: true });
    rmdirSync(directory);
  }
});

async function startServer(corsOrigins = '') {
  app = buildApp(parseEnvironment({
    DATABASE_PATH: databasePath,
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: corsOrigins,
  }));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return (path: string, init?: RequestInit) =>
    fetch(address + path, { signal: AbortSignal.timeout(3000), ...init });
}

describe('HTTP readiness', () => {
  it('reports a migrated database and leaves CORS disabled by default', async () => {
    const request = await startServer();
    const response = await request('/api/v1/health', { headers: { origin: 'http://localhost:5173' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({ status: 'ok', checks: { sqlite: 'ok' } });
  });

  it('returns a JSON 503 when the database schema is unavailable', async () => {
    const request = await startServer();
    const db = new Database(databasePath);
    try {
      db.exec('DROP TABLE schema_migrations');
    } finally {
      db.close();
    }

    const response = await request('/api/v1/health');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'HTTP_503', message: 'Service Unavailable', requestId: expect.any(String) },
    });
  });

  it('permits CORS preflight only for an exact configured origin', async () => {
    const origin = 'http://localhost:5173';
    const request = await startServer(origin);
    const preflight = (requestedOrigin: string) => request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: requestedOrigin, 'access-control-request-method': 'GET' },
    });

    const allowed = await preflight(origin);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
    expect(allowed.headers.get('access-control-allow-methods')?.split(',')).toContain('GET');
    expect((await preflight('http://localhost:5174')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('uses the same JSON error envelope for unknown routes and malformed preflight', async () => {
    const request = await startServer('http://localhost:5173');
    const missing = await request('/api/v1/missing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: 'HTTP_404', message: 'Not Found', requestId: expect.any(String) },
    });

    const malformed = await request('/api/v1/health', { method: 'OPTIONS' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: { code: 'HTTP_400', message: 'Bad Request', requestId: expect.any(String) },
    });
  });
});

describe('SQLite migrations', () => {
  it('records a migration once and keeps it across connections', () => {
    openDatabase(databasePath).close();
    const db = openDatabase(databasePath);
    try {
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it('refuses to migrate an unrelated SQLite database', () => {
    const db = new Database(databasePath);
    try {
      db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
      expect(() => openDatabase(databasePath)).toThrow('Refusing to initialize a non-empty SQLite database');
      expect(db.pragma('application_id', { simple: true })).toBe(0);
      expect(db.prepare('SELECT name FROM sqlite_schema WHERE type = ?').all('table')).toEqual([
        { name: 'unrelated' },
      ]);
    } finally {
      db.close();
    }
  });

  it('refuses to start with migration history from a newer build', () => {
    const db = openDatabase(databasePath);
    try {
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(2, 'future_migration');
      expect(() => openDatabase(databasePath)).toThrow('SQLite migration history does not match');
    } finally {
      db.close();
    }
  });
});
