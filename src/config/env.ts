import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const httpOrigin = z.string().refine((origin) => {
  const url = URL.parse(origin);
  return url?.origin === origin && (url.protocol === 'http:' || url.protocol === 'https:');
}, 'Use an HTTP(S) origin without a path, credentials, query, or fragment');

const environmentSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().regex(/^\d+$/, 'Use an integer port')
    .transform(Number).pipe(z.number().int().min(1).max(65535)).prefault('3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_PATH: z.string().trim().min(1).default('.driftguard/driftguard.sqlite'),
  CORS_ORIGINS: z.string().prefault('').transform((value) =>
    value.trim() === '' ? [] : value.split(',').map((origin) => origin.trim()),
  ).pipe(z.array(httpOrigin)),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')} (${issue.message})`);
    throw new Error(`Invalid environment configuration: ${details.join(', ')}`);
  }
  return result.data;
}

export function loadEnvironment(): Environment {
  const { error } = loadDotenv({ quiet: true });
  if (error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('Could not read .env', { cause: error });
  }
  return parseEnvironment(process.env);
}
