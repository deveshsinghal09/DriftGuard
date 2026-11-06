import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';

describe('environment validation', () => {
  it('defaults to a loopback listener, a local database, and no CORS', () => {
    expect(parseEnvironment({})).toEqual({
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_PATH: '.driftguard/driftguard.sqlite',
      CORS_ORIGINS: [],
    });
  });

  it('parses the configured port and trims an explicit list of origins', () => {
    expect(parseEnvironment({
      PORT: '8080',
      CORS_ORIGINS: ' http://localhost:5173, https://driftguard.example ',
    })).toMatchObject({
      PORT: 8080,
      CORS_ORIGINS: ['http://localhost:5173', 'https://driftguard.example'],
    });
  });

  it.each([
    ['PORT', '65536'],
    ['PORT', '1e3'],
    ['LOG_LEVEL', 'verbose'],
    ['DATABASE_PATH', ' '],
    ['CORS_ORIGINS', '*'],
    ['CORS_ORIGINS', 'https://example.test/path'],
  ])('rejects invalid %s values', (name, value) => {
    expect(() => parseEnvironment({ [name]: value })).toThrow(`Invalid environment configuration: ${name}`);
  });
});
