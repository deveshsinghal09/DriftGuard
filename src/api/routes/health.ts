import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { assertDatabaseReady } from '../../db/migrations.js';
import { sendHttpError } from '../errors.js';

export function registerHealthRoute(app: FastifyInstance, db: Database): void {
  app.get('/api/v1/health', async (request, reply) => {
    reply.header('cache-control', 'no-store');

    try {
      assertDatabaseReady(db);
    } catch (error) {
      request.log.error({ err: error }, 'SQLite readiness check failed');
      return sendHttpError(request, reply, 503);
    }

    return { status: 'ok', checks: { sqlite: 'ok' } };
  });
}
