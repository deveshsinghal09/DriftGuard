import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { EngineeringTask } from '../domain/engineering-task.js';
import { GitHubError } from '../integrations/github/errors.js';
import { IssueSync } from './issue-sync.js';
import { RepositoryRegistry } from './repository-registry.js';

const columns = `
  id, repository_id AS repositoryId, github_issue_id AS githubIssueId, github_issue_number AS githubIssueNumber,
  source_url AS sourceUrl, title, description, status, assigned_agent AS assignedAgent, decision_id AS decisionId,
  created_at AS createdAt, updated_at AS updatedAt
`;

export class EngineeringTasks {
  private readonly registry: RepositoryRegistry;
  private readonly issues: IssueSync;

  constructor(private readonly db: Database) {
    this.registry = new RepositoryRegistry(db);
    this.issues = new IssueSync(db);
  }

  list(name: string): EngineeringTask[] {
    const { repository } = this.registry.readable(name);
    return this.db.prepare<[number], EngineeringTask>(`
      SELECT ${columns} FROM engineering_tasks WHERE repository_id = ? ORDER BY created_at, id
    `).all(repository.repositoryId);
  }

  inspect(name: string, id: string): EngineeringTask {
    const { repository } = this.registry.readable(name);
    const task = this.db.prepare<[number, string], EngineeringTask>(`
      SELECT ${columns} FROM engineering_tasks WHERE repository_id = ? AND id = ?
    `).get(repository.repositoryId, id);
    if (!task) throw new GitHubError('TASK_NOT_FOUND', 'Task does not exist in this repository.');
    return task;
  }

  createFromIssue(name: string, issueNumber: number, needsClarification = false): EngineeringTask {
    return this.db.transaction(() => {
      const issue = this.issues.inspect(name, issueNumber);
      const existing = this.db.prepare<[number, number], EngineeringTask>(`
        SELECT ${columns} FROM engineering_tasks WHERE repository_id = ? AND github_issue_id = ?
      `).get(issue.repositoryId, issue.githubIssueId);
      if (existing) return existing;
      if (issue.syncState !== 'OPEN') throw new GitHubError('ISSUE_NOT_OPEN', 'Task creation requires an open synced GitHub issue.');

      const id = randomUUID();
      const time = new Date().toISOString();
      const status = needsClarification ? 'NEEDS_CLARIFICATION' : 'DISCOVERED';
      this.db.prepare(`
        INSERT INTO engineering_tasks (id, repository_id, github_issue_id, github_issue_number, source_url,
          title, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, issue.repositoryId, issue.githubIssueId, issue.issueNumber, issue.url,
        issue.title, issue.body, status, time, time);
      return this.inspect(name, id);
    }).immediate();
  }
}
