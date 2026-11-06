import pino from 'pino';
import { loadEnvironment } from '../config/env.js';
import { buildApp } from './build-app.js';

async function main() {
  const env = loadEnvironment();
  const app = buildApp(env);
  let closing: Promise<void> | undefined;

  function shutdown(signal: NodeJS.Signals) {
    if (closing) return;

    app.log.info({ signal }, 'Shutting down');
    closing = app.close();
    void closing.catch((error: unknown) => {
      app.log.error({ err: error }, 'Shutdown failed');
      process.exitCode = 1;
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (error) {
    if (closing) return;

    await app.close().catch((closeError: unknown) => {
      app.log.error({ err: closeError }, 'Startup cleanup failed');
    });
    throw error;
  }
}

main().catch((error: unknown) => {
  pino().fatal({ err: error }, 'Server failed to start');
  process.exitCode = 1;
});
