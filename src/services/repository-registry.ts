import type { Database } from 'better-sqlite3';
import {
  getGitHubIdentity, getRepository, repositorySlug, writePermissions,
  type GitHubRequest, type RepositoryMetadata, type RepositoryPermission,
} from '../integrations/github/client.js';
import { GitHubError } from '../integrations/github/errors.js';

export type RegisteredRepository = Pick<
  RepositoryMetadata, 'repositoryId' | 'owner' | 'name' | 'url' | 'defaultBranch' | 'visibility' | 'permissionLevel'
> & { readEnabled: boolean; writeEnabled: boolean; active: boolean; addedAt: string };

type RepositoryRow = Omit<RegisteredRepository, 'readEnabled' | 'writeEnabled' | 'active'> &
  { readEnabled: number; writeEnabled: number; active: number; syncVersion: number };

const columns = `
  repository_id AS repositoryId, owner, name, url, default_branch AS defaultBranch, visibility,
  permission_level AS permissionLevel, read_enabled AS readEnabled, write_enabled AS writeEnabled,
  active, added_at AS addedAt, sync_version AS syncVersion
`;

function publicRecord({ readEnabled, writeEnabled, active, syncVersion: _syncVersion, ...rest }: RepositoryRow): RegisteredRepository {
  return { ...rest, readEnabled: Boolean(readEnabled), writeEnabled: Boolean(writeEnabled), active: Boolean(active) };
}

export function mayWriteRepository(repo: RepositoryMetadata): boolean {
  const writable: readonly RepositoryPermission[] = writePermissions;
  return !repo.archived && !repo.disabled && writable.includes(repo.permissionLevel);
}

export class RepositoryRegistry {
  constructor(private readonly db: Database) {}

  list(): RegisteredRepository[] {
    return this.db.prepare<[], RepositoryRow>(`SELECT ${columns} FROM github_repositories ORDER BY slug`)
      .all().map(publicRecord);
  }

  inspect(name: string): RegisteredRepository {
    return publicRecord(this.find(name));
  }

  readable(name: string): { repository: RegisteredRepository; syncVersion: number } {
    const row = this.find(name);
    if (!row.active || !row.readEnabled) {
      throw new GitHubError('REPOSITORY_NOT_ALLOWED', 'Repository reading is disabled in the local registry.');
    }
    return { repository: publicRecord(row), syncVersion: row.syncVersion };
  }

  async add(name: string, writeEnabled: boolean, request: GitHubRequest): Promise<RegisteredRepository> {
    const slug = repositorySlug(name);
    const identity = await getGitHubIdentity(request);
    if (slug.split('/')[0] !== identity.login.toLowerCase()) {
      throw new GitHubError('REPOSITORY_NOT_OWNED', 'Only repositories owned by the authenticated GitHub account may be registered.');
    }
    const repo = await getRepository(request, slug);
    if (repo.disabled || (writeEnabled && !mayWriteRepository(repo))) {
      throw new GitHubError('REPOSITORY_WRITE_DENIED', 'This repository does not support the requested access.');
    }

    return this.db.transaction(() => {
      const existing = this.db.prepare<[string], { repositoryId: number }>(
        'SELECT repository_id AS repositoryId FROM github_repositories WHERE slug = ?',
      ).get(slug);
      if (existing && existing.repositoryId !== repo.repositoryId) {
        throw new GitHubError('REPOSITORY_CHANGED', 'This name is already registered to a different GitHub repository ID.');
      }
      this.db.prepare(`
        INSERT INTO github_repositories (repository_id, slug, owner, name, url, default_branch, visibility,
          permission_level, read_enabled, write_enabled, active, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?)
        ON CONFLICT(repository_id) DO UPDATE SET slug = excluded.slug, owner = excluded.owner,
          name = excluded.name, url = excluded.url, default_branch = excluded.default_branch,
          visibility = excluded.visibility, permission_level = excluded.permission_level, read_enabled = 1,
          write_enabled = excluded.write_enabled, active = 1, sync_version = sync_version + 1
      `).run(repo.repositoryId, slug, repo.owner, repo.name, repo.url, repo.defaultBranch, repo.visibility,
        repo.permissionLevel, Number(writeEnabled), new Date().toISOString());
      return this.inspect(slug);
    }).immediate();
  }

  disable(name: string): RegisteredRepository {
    const slug = repositorySlug(name);
    return this.db.transaction(() => {
      const row = this.find(slug);
      this.db.prepare(`
        UPDATE github_repositories SET read_enabled = 0, write_enabled = 0, active = 0, sync_version = sync_version + 1
        WHERE repository_id = ?
      `).run(row.repositoryId);
      return this.inspect(slug);
    }).immediate();
  }

  private find(name: string): RepositoryRow {
    const slug = repositorySlug(name);
    const row = this.db.prepare<[string], RepositoryRow>(`SELECT ${columns} FROM github_repositories WHERE slug = ?`).get(slug);
    if (!row) throw new GitHubError('REPOSITORY_NOT_ALLOWED', 'Repository is not in the local registry.');
    return row;
  }
}
