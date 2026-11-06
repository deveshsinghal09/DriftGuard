import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AgentRole } from '../domain/handoff.js';

export type WorkflowRole = 'owner' | AgentRole;
const tokenVariables = {
  owner: 'WORKFLOW_OWNER_TOKEN',
  guardian: 'WORKFLOW_GUARDIAN_TOKEN',
  builder: 'WORKFLOW_BUILDER_TOKEN',
  verifier: 'WORKFLOW_VERIFIER_TOKEN',
} as const satisfies Record<WorkflowRole, string>;
const roles = Object.keys(tokenVariables) as WorkflowRole[];
const tokenPattern = /^[A-Za-z0-9_-]{43,128}$/;

export const repositorySchema = z.string().trim()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/i)
  .refine((repository) => !/\/\.{1,2}$/.test(repository))
  .transform((repository) => repository.toLowerCase());

export interface WorkflowConfig {
  allowedRepositories: ReadonlySet<string>;
  authenticate(authorization: string | undefined): WorkflowRole | undefined;
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function configureWorkflow(source: NodeJS.ProcessEnv, host: string): WorkflowConfig | undefined {
  const tokens = roles.map((role) => source[tokenVariables[role]] ?? '');
  const rawRepositories = source.WORKFLOW_ALLOWED_REPOS?.trim() || '';
  if (tokens.every((token) => token === '') && rawRepositories === '') return undefined;
  if (tokens.some((token) => !tokenPattern.test(token)) || new Set(tokens).size !== roles.length) {
    throw new Error('Configure a distinct base64url token of 43 to 128 characters for each WORKFLOW role');
  }
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('The workflow API requires a loopback HOST');
  }

  const repositories = z.array(repositorySchema).safeParse(rawRepositories ? rawRepositories.split(',') : []);
  if (!repositories.success) throw new Error('WORKFLOW_ALLOWED_REPOS must be a comma-separated list of owner/repo values');

  const credentials = tokens.map(digest);
  return {
    allowedRepositories: new Set(repositories.data),
    authenticate(authorization) {
      const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/i)?.[1];
      if (!token) return undefined;

      const presented = digest(token);
      return roles[credentials.findIndex((expected) => timingSafeEqual(presented, expected))];
    },
  };
}
