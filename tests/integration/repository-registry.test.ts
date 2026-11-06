import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import { getGitHubIdentity, githubRequest } from '../../src/integrations/github/client.js';
import { RepositoryRegistry } from '../../src/services/repository-registry.js';

let db: ReturnType<typeof openDatabase>;
let registry: RepositoryRegistry;
const metadata = {
  id: 1100, full_name: 'owner/Project', owner: { login: 'owner' }, name: 'Project',
  html_url: 'https://github.com/owner/Project', default_branch: 'main', visibility: 'public',
  has_issues: true, archived: false, disabled: false, permissions: { admin: true },
};

beforeEach(() => {
  db = openDatabase(':memory:');
  registry = new RepositoryRegistry(db);
});
afterEach(() => db.close());

function github(repository: Record<string, unknown> = metadata) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/user')) {
      return Response.json({ login: 'owner' }, { headers: { 'x-oauth-scopes': 'repo, read:org' } });
    }
    return Response.json(repository);
  });
  return { fetcher, request: githubRequest('test_token', fetcher) };
}

describe('GitHub repository registry', () => {
  it('uses the authenticated owner and GitHub ID, defaults to read-only, and requires an explicit write grant', async () => {
    const { request } = github();
    expect(await getGitHubIdentity(request)).toEqual({ login: 'owner', scopes: ['repo', 'read:org'] });
    const initial = await registry.add('OWNER/Project', false, request);
    expect(initial).toMatchObject({ repositoryId: 1100, readEnabled: true, writeEnabled: false, active: true });
    expect(await registry.add('owner/project', true, request)).toMatchObject({ addedAt: initial.addedAt, writeEnabled: true });
    expect(registry.list()).toHaveLength(1);
    expect(registry.disable('OWNER/project')).toMatchObject({ readEnabled: false, writeEnabled: false, active: false });
    expect(() => registry.readable('owner/project')).toThrow(expect.objectContaining({ code: 'REPOSITORY_NOT_ALLOWED' }));
  });

  it('blocks path injection before HTTP and blocks another owner before fetching its repository', async () => {
    const { fetcher, request } = github();
    await expect(registry.add('owner/project/../../foreign/repo', false, request))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(registry.add('foreign/project', false, request)).rejects.toMatchObject({ code: 'REPOSITORY_NOT_OWNED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://api.github.com/user');
  });

  it('rejects insufficient permissions and refuses to reuse an existing slug for a different GitHub ID', async () => {
    const { request } = github({ ...metadata, permissions: { pull: true } });
    await expect(registry.add('owner/project', true, request)).rejects.toMatchObject({ code: 'REPOSITORY_WRITE_DENIED' });
    await registry.add('owner/project', false, request);
    await expect(registry.add('owner/project', false, github({ ...metadata, id: 9000 }).request))
      .rejects.toMatchObject({ code: 'REPOSITORY_CHANGED' });
    expect(registry.inspect('owner/project').repositoryId).toBe(1100);
  });

  it.each([401, 403])('classifies GitHub HTTP %i without leaking a response body', async (status) => {
    const request = githubRequest('test_token', vi.fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message: 'sensitive detail' }, { status })));
    await expect(getGitHubIdentity(request)).rejects.toMatchObject({
      code: status === 401 ? 'GITHUB_AUTH' : 'GITHUB_FORBIDDEN',
      message: expect.not.stringContaining('sensitive detail'),
    });
  });

  it('returns a retry time for a GitHub rate limit and refuses cross-host redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, {
      status: 429, headers: { 'retry-after': '10' },
    })).mockResolvedValueOnce(Response.redirect('https://example.com/'));
    const request = githubRequest('test_token', fetcher);
    await expect(getGitHubIdentity(request)).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMIT', retryAt: expect.any(String) });
    await expect(getGitHubIdentity(request)).rejects.toMatchObject({ code: 'REPOSITORY_CHANGED' });
    expect(fetcher).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'manual' }));
  });
});
