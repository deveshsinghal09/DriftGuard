import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import pino from 'pino';
import { sendHttpError } from '../api/errors.js';
import { registerHealthRoute } from '../api/routes/health.js';
import { registerWorkflowRoutes } from '../api/routes/workflow.js';
import type { Environment } from '../config/env.js';
import { openDatabase } from '../db/database.js';
import type { WorkflowConfig } from '../security/workflow-auth.js';

export function buildApp(env: Environment, workflow?: WorkflowConfig) {
  const app = Fastify({
    loggerInstance: pino({
      level: env.LOG_LEVEL,
      serializers: {
        req(request: FastifyRequest) {
          return { method: request.method, path: request.url.split('?', 1)[0] };
        },
      },
    }),
    genReqId: () => randomUUID(),
  });

  app.setNotFoundHandler((request, reply) => sendHttpError(request, reply, 404));
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
      return sendHttpError(request, reply, status);
    }

    request.log.error({ err: error }, 'Request failed');
    return sendHttpError(request, reply, 500);
  });

  if (env.CORS_ORIGINS.length > 0) {
    app.addHook('onRequest', async (request, reply) => {
      // Respond with the API's JSON error before CORS handles malformed preflights.
      if (request.method === 'OPTIONS' &&
          (!request.headers.origin || !request.headers['access-control-request-method'])) {
        return sendHttpError(request, reply, 400);
      }
    });
    app.register(cors, { origin: env.CORS_ORIGINS, methods: ['GET', 'HEAD'] });
  }

  app.register(async (api) => {
    const db = openDatabase(env.DATABASE_PATH);
    api.addHook('onClose', async () => db.close());
    registerHealthRoute(api, db);
    if (workflow) registerWorkflowRoutes(api, db, workflow);
  });

  return app;
}
