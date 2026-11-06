import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { repositorySchema } from '../../security/workflow-auth.js';
import { GitHubError } from './errors.js';

const githubOrigin = 'https://api.github.com';
const accountSchema = z.object({ login: z.string().min(1) });
const permissionSchema = z.object({
  admin: z.boolean().optional(), maintain: z.boolean().optional(), push: z.boolean().optional(),
  triage: z.boolean().optional(), pull: z.boolean().optional(),
});
const repositoryResponseSchema = z.object({
  id: z.int().positive(),
  full_name: repositorySchema,
  owner: accountSchema,
  name: z.string().min(1),
  html_url: z.string(),
  default_branch: z.string().min(1),
  visibility: z.enum(['public', 'private', 'internal']),
  has_issues: z.boolean(),
  archived: z.boolean(),
  disabled: z.boolean(),
  permissions: permissionSchema.optional(),
});

export const writePermissions = ['admin', 'maintain', 'push'] as const;
const permissions = [...writePermissions, 'triage', 'pull'] as const;
export type RepositoryPermission = typeof permissions[number] | 'none';
export type RepositoryMetadata = {
  repositoryId: number;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  permissionLevel: RepositoryPermission;
  hasIssues: boolean;
  archived: boolean;
  disabled: boolean;
};

export type GitHubRequest = (path: string) => Promise<{ body: unknown; headers: Headers }>;

export function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new GitHubError('GITHUB_RESPONSE', 'GitHub returned an unexpected response');
  return result.data;
}

export function repositorySlug(value: string): string {
  const result = repositorySchema.safeParse(value);
  if (!result.success) throw new GitHubError('INVALID_ARGUMENT', 'Use a GitHub repository name in owner/repo format');
  return result.data;
}

function retryAt(headers: Headers): string {
  const now = Date.now();
  const retry = headers.get('retry-after');
  const reset = headers.get('x-ratelimit-reset');
  let time = now + 60_000;
  if (retry !== null) time = /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  else if (reset !== null && headers.get('x-ratelimit-remaining') === '0') time = Number(reset) * 1000;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) && time >= now ? date.toISOString() : new Date(now + 60_000).toISOString();
}

export function githubRequest(token: string, send: typeof fetch = fetch): GitHubRequest {
  return async (path) => {
    const url = new URL(path, githubOrigin);
    if (!path.startsWith('/') || url.origin !== githubOrigin || url.username || url.password || url.hash) {
      throw new GitHubError('INVALID_ARGUMENT', 'Invalid GitHub API path');
    }
    let response: Response;
    try {
      response = await send(url, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      });
    } catch {
      throw new GitHubError('GITHUB_NETWORK', 'GitHub could not be reached. Retry the operation.');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new GitHubError('REPOSITORY_CHANGED', 'GitHub redirected the request. Verify the repository and register its current name.');
    }
    if (!response.ok) {
      let rateMessage = false;
      if (response.status === 403) {
        const result = z.object({ message: z.string() }).safeParse(await response.json().catch(() => null));
        rateMessage = result.success && /rate limit/i.test(result.data.message);
      } else {
        await response.body?.cancel().catch(() => {});
      }
      if (response.status === 429 || (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || rateMessage))) {
        throw new GitHubError('GITHUB_RATE_LIMIT', 'GitHub rate limit reached. Retry after the indicated time.', retryAt(response.headers));
      }
      if (response.status === 401) throw new GitHubError('GITHUB_AUTH', 'GitHub rejected the credential. Check gh auth status.');
      if (response.status === 403) throw new GitHubError('GITHUB_FORBIDDEN', 'GitHub denied access to this resource.');
      if (response.status === 404 || response.status === 410) {
        throw new GitHubError('GITHUB_NOT_FOUND', 'GitHub could not find this resource or it is unavailable.');
      }
      if (response.status >= 500) throw new GitHubError('GITHUB_NETWORK', 'GitHub is temporarily unavailable. Retry the operation.');
      throw new GitHubError('GITHUB_RESPONSE', 'GitHub rejected the API request.');
    }
    const body: unknown = await response.json().catch((error: unknown) => {
      if (!(error instanceof SyntaxError)) throw new GitHubError('GITHUB_NETWORK', 'GitHub response was interrupted. Retry the operation.');
      throw new GitHubError('GITHUB_RESPONSE', 'GitHub returned invalid JSON.');
    });
    return { body, headers: response.headers };
  };
}

export async function authenticatedGitHub(): Promise<GitHubRequest> {
  let token: string;
  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 16_384,
    });
    token = stdout.trim();
  } catch {
    throw new GitHubError('GITHUB_AUTH', 'GitHub CLI authentication is unavailable. Check gh auth status.');
  }
  if (!/^[A-Za-z0-9_]+$/.test(token)) {
    throw new GitHubError('GITHUB_AUTH', 'GitHub CLI did not return a usable credential.');
  }
  return githubRequest(token);
}

export async function getGitHubIdentity(request: GitHubRequest) {
  const { body, headers } = await request('/user');
  const { login } = parseResponse(accountSchema, body);
  return { login, scopes: headers.get('x-oauth-scopes')?.split(',').map((scope) => scope.trim()).filter(Boolean) ?? [] };
}

export async function getRepository(request: GitHubRequest, name: string): Promise<RepositoryMetadata> {
  const slug = repositorySlug(name);
  const { body } = await request('/repos/' + slug);
  const data = parseResponse(repositoryResponseSchema, body);
  if (data.full_name !== slug || repositorySlug(data.owner.login + '/' + data.name) !== slug ||
      data.html_url.toLowerCase() !== 'https://github.com/' + slug) {
    throw new GitHubError('REPOSITORY_CHANGED', 'GitHub returned a different repository.');
  }
  return {
    repositoryId: data.id,
    owner: data.owner.login,
    name: data.name,
    url: data.html_url,
    defaultBranch: data.default_branch,
    visibility: data.visibility,
    permissionLevel: permissions.find((level) => data.permissions?.[level] === true) ?? 'none',
    hasIssues: data.has_issues,
    archived: data.archived,
    disabled: data.disabled,
  };
}
