import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticatedGitHub, repositorySlug } from '../../integrations/github/client.js';
import { GitHubError, type GitHubErrorCode } from '../../integrations/github/errors.js';
import type { WorkflowConfig } from '../../security/workflow-auth.js';
import { EngineeringTasks } from '../../services/engineering-tasks.js';
import { IssueSync } from '../../services/issue-sync.js';
import { RepositoryRegistry } from '../../services/repository-registry.js';
import { sendHttpError } from '../errors.js';
import { workflowAuthentication } from '../workflow-handler.js';

const repositoryPath = z.object({ owner: z.string(), repo: z.string() });
const issuePath = repositoryPath.extend({ issueNumber: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().positive()) });
const syncBody = z.strictObject({ full: z.boolean().optional() });
const taskBody = z.strictObject({ needsClarification: z.boolean().optional() });
const statusCodes: Record<GitHubErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  GITHUB_AUTH: 502,
  GITHUB_FORBIDDEN: 403,
  GITHUB_RATE_LIMIT: 429,
  GITHUB_NETWORK: 503,
  GITHUB_RESPONSE: 502,
  GITHUB_NOT_FOUND: 404,
  REPOSITORY_CHANGED: 409,
  REPOSITORY_NOT_ALLOWED: 403,
  REPOSITORY_NOT_OWNED: 403,
  REPOSITORY_WRITE_DENIED: 403,
  ISSUES_DISABLED: 409,
  SYNC_CONFLICT: 409,
  ISSUE_NOT_FOUND: 404,
  ISSUE_NOT_OPEN: 409,
  TASK_NOT_FOUND: 404,
};

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new GitHubError('INVALID_ARGUMENT', 'Invalid GitHub route parameters or body.');
  return result.data;
}

function slug({ owner, repo }: z.infer<typeof repositoryPath>): string {
  return repositorySlug(owner + '/' + repo);
}

export function registerGitHubRoutes(app: FastifyInstance, db: Database, config: WorkflowConfig): void {
  const registry = new RepositoryRegistry(db);
  const issues = new IssueSync(db);
  const tasks = new EngineeringTasks(db);
  const authenticated = workflowAuthentication(config);
  const review = (handler: (request: FastifyRequest) => unknown) => authenticated(async (actor, request, reply) => {
    if (actor !== 'guardian' && actor !== 'owner') return sendHttpError(request, reply, 403);
    try {
      return await handler(request);
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      return reply.code(statusCodes[error.code]).send({
        error: { code: error.code, message: error.message, retryAt: error.retryAt, requestId: request.id },
      });
    }
  });

  const root = '/api/v1/github/repositories/:owner/:repo';
  app.get(root, review((request) => registry.readable(slug(parseInput(repositoryPath, request.params))).repository));
  app.post(root + '/issues/sync', review(async (request) => {
    const repository = slug(parseInput(repositoryPath, request.params));
    const { full } = parseInput(syncBody, request.body === undefined ? {} : request.body);
    registry.readable(repository);
    return issues.sync(repository, await authenticatedGitHub(), full);
  }));
  app.get(root + '/issues', review((request) => issues.list(slug(parseInput(repositoryPath, request.params)))));
  app.get(root + '/issues/:issueNumber', review((request) => {
    const params = parseInput(issuePath, request.params);
    return issues.inspect(slug(params), params.issueNumber);
  }));
  app.post(root + '/issues/:issueNumber/task', review((request) => {
    const params = parseInput(issuePath, request.params);
    const { needsClarification } = parseInput(taskBody, request.body === undefined ? {} : request.body);
    return tasks.createFromIssue(slug(params), params.issueNumber, needsClarification);
  }));
}
