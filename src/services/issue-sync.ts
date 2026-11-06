import type { Database } from 'better-sqlite3';
import { getGitHubIdentity, getRepository, repositorySlug, type GitHubRequest } from '../integrations/github/client.js';
import { GitHubError } from '../integrations/github/errors.js';
import {
  getIssue, listIssueComments, listIssuePullRequests, listOpenIssues, type IssueComment, type IssueSummary,
} from '../integrations/github/issues.js';
import { mayWriteRepository, RepositoryRegistry } from './repository-registry.js';

type IssueDetails = Pick<IssueSummary, 'createdAt' | 'closedAt' | 'commentCount' | 'labels' | 'assignees'> &
  { comments: IssueComment[]; linkedPullRequests: string[] };
type IssueFields = Omit<IssueSummary, keyof IssueDetails | 'syncState'> &
  { repositoryId: number; syncState: 'OPEN' | 'CLOSED' | 'UNAVAILABLE' };
type StoredIssue = IssueFields & { details: string };
export type IssueSnapshot = IssueFields & IssueDetails;

const columns = `
  repository_id AS repositoryId, github_issue_id AS githubIssueId, issue_number AS issueNumber,
  title, body, url, author, updated_at AS updatedAt, sync_state AS syncState, details
`;

function snapshot({ details, ...issue }: StoredIssue): IssueSnapshot {
  return { ...issue, ...(JSON.parse(details) as IssueDetails) };
}

function details(issue: IssueSnapshot): string {
  const { createdAt, closedAt, commentCount, labels, assignees, comments, linkedPullRequests } = issue;
  return JSON.stringify({ createdAt, closedAt, commentCount, labels, assignees, comments, linkedPullRequests });
}

export class IssueSync {
  private readonly registry: RepositoryRegistry;

  constructor(private readonly db: Database) {
    this.registry = new RepositoryRegistry(db);
  }

  list(name: string, includeUnavailable = false): IssueSnapshot[] {
    const { repository } = this.registry.readable(name);
    return this.rows(repository.repositoryId).filter((row) => includeUnavailable || row.syncState === 'OPEN').map(snapshot);
  }

  inspect(name: string, issueNumber: number): IssueSnapshot {
    const { repository } = this.registry.readable(name);
    const row = this.db.prepare<[number, number], StoredIssue>(
      `SELECT ${columns} FROM github_issues WHERE repository_id = ? AND issue_number = ?`,
    ).get(repository.repositoryId, issueNumber);
    if (!row) throw new GitHubError('ISSUE_NOT_FOUND', 'Issue is not in this repository’s local cache. Sync it first.');
    return snapshot(row);
  }

  async sync(name: string, request: GitHubRequest, full = false) {
    const slug = repositorySlug(name);
    const { repository, syncVersion } = this.registry.readable(slug);
    const identity = await getGitHubIdentity(request);
    if (repository.owner.toLowerCase() !== identity.login.toLowerCase()) {
      throw new GitHubError('REPOSITORY_NOT_OWNED', 'The current GitHub account does not own the registered repository.');
    }

    const verifyRepository = async () => {
      const current = await getRepository(request, slug);
      if (current.repositoryId !== repository.repositoryId || current.disabled) {
        throw new GitHubError('REPOSITORY_CHANGED', 'The registered repository ID or availability changed.');
      }
      if (!current.hasIssues) throw new GitHubError('ISSUES_DISABLED', 'Issues are disabled for this repository.');
      return current;
    };
    await verifyRepository();
    const oldIssues = new Map(this.rows(repository.repositoryId).map((row) => [row.issueNumber, snapshot(row)]));
    const incoming = new Map<number, IssueSummary>();
    for (const issue of await listOpenIssues(request, slug)) {
      const prior = incoming.get(issue.issueNumber) ?? oldIssues.get(issue.issueNumber);
      if (prior && prior.githubIssueId !== issue.githubIssueId) {
        throw new GitHubError('REPOSITORY_CHANGED', 'GitHub returned a different issue ID for a known issue number.');
      }
      if (!incoming.has(issue.issueNumber) || !prior || issue.updatedAt >= prior.updatedAt) {
        incoming.set(issue.issueNumber, issue);
      }
    }

    const updates: IssueSnapshot[] = [];
    for (const old of oldIssues.values()) {
      if (incoming.has(old.issueNumber) || (!full && old.syncState !== 'OPEN')) continue;
      const issue = await getIssue(request, slug, old.issueNumber);
      if (!issue) updates.push({ ...old, syncState: 'UNAVAILABLE' });
      else if (issue.githubIssueId !== old.githubIssueId) {
        throw new GitHubError('REPOSITORY_CHANGED', 'GitHub returned a different issue ID for a known issue number.');
      } else {
        incoming.set(issue.issueNumber, issue);
      }
    }

    for (const issue of incoming.values()) {
      const old = oldIssues.get(issue.issueNumber);
      // Comment edits may leave the parent issue timestamp unchanged.
      const comments = issue.commentCount > 0 ? await listIssueComments(request, slug, issue.issueNumber) : [];
      const refreshLinks = full || !old || old.updatedAt !== issue.updatedAt || old.syncState !== issue.syncState
        || JSON.stringify(old.comments) !== JSON.stringify(comments);
      const linkedPullRequests = refreshLinks
        ? await listIssuePullRequests(request, slug, issue.issueNumber)
        : old.linkedPullRequests;
      updates.push({ ...issue, repositoryId: repository.repositoryId, comments, linkedPullRequests });
    }
    const current = await verifyRepository();

    return this.db.transaction(() => {
      const advanced = this.db.prepare(`
        UPDATE github_repositories SET default_branch = ?, visibility = ?, permission_level = ?,
          write_enabled = CASE WHEN ? THEN write_enabled ELSE 0 END, sync_version = sync_version + 1
        WHERE repository_id = ? AND slug = ? AND sync_version = ? AND active = 1 AND read_enabled = 1
      `).run(current.defaultBranch, current.visibility, current.permissionLevel, Number(mayWriteRepository(current)),
        repository.repositoryId, slug, syncVersion);
      if (advanced.changes !== 1) throw new GitHubError('SYNC_CONFLICT', 'Repository access or another sync changed. Retry the operation.');

      const upsert = this.db.prepare(`
        INSERT INTO github_issues (repository_id, github_issue_id, issue_number, title, body, url, author,
          updated_at, sync_state, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository_id, github_issue_id) DO UPDATE SET
          title = excluded.title, body = excluded.body, url = excluded.url, author = excluded.author,
          updated_at = excluded.updated_at, sync_state = excluded.sync_state, details = excluded.details
        WHERE github_issues.title IS NOT excluded.title OR github_issues.body IS NOT excluded.body
          OR github_issues.url IS NOT excluded.url OR github_issues.author IS NOT excluded.author
          OR github_issues.updated_at IS NOT excluded.updated_at OR github_issues.sync_state IS NOT excluded.sync_state
          OR github_issues.details IS NOT excluded.details
      `);
      let changedIssues = 0;
      for (const issue of updates) {
        changedIssues += upsert.run(issue.repositoryId, issue.githubIssueId, issue.issueNumber, issue.title, issue.body,
          issue.url, issue.author, issue.updatedAt, issue.syncState, details(issue)).changes;
      }
      const rows = this.rows(repository.repositoryId);
      return {
        repositoryId: repository.repositoryId, changedIssues,
        openIssues: rows.filter(({ syncState }) => syncState === 'OPEN').length,
        closedIssues: rows.filter(({ syncState }) => syncState === 'CLOSED').length,
        unavailableIssues: rows.filter(({ syncState }) => syncState === 'UNAVAILABLE').length,
      };
    }).immediate();
  }

  private rows(repositoryId: number): StoredIssue[] {
    return this.db.prepare<[number], StoredIssue>(
      `SELECT ${columns} FROM github_issues WHERE repository_id = ? ORDER BY issue_number`,
    ).all(repositoryId);
  }
}
