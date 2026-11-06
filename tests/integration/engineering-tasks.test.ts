import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import type { GitHubRequest } from '../../src/integrations/github/client.js';
import { EngineeringTasks } from '../../src/services/engineering-tasks.js';
import { IssueSync } from '../../src/services/issue-sync.js';
import { RepositoryRegistry } from '../../src/services/repository-registry.js';

const repo = 'owner/project';
const otherRepo = 'owner/other';
const timestamp = '2026-11-06T06:00:00Z';
const originalBody = 'Report the observed behavior and verify it in an independent checkout.';
let directory: string;
let filename: string;
let db: ReturnType<typeof openDatabase>;
let tasks: EngineeringTasks;

function github(name: string, id: number, includeIssue = true): GitHubRequest {
  const slug = 'owner/' + name;
  return async (path) => {
    let body: unknown = [];
    if (path === '/user') body = { login: 'owner' };
    if (path === '/repos/' + slug) body = {
      id, full_name: slug, owner: { login: 'owner' }, name, html_url: 'https://github.com/' + slug,
      default_branch: 'main', visibility: 'public', has_issues: true, archived: false, disabled: false,
    };
    if (path.startsWith('/repos/' + slug + '/issues?') && includeIssue) {
      body = [{
        id: 5040, number: 4, title: 'Check the exact candidate', body: originalBody,
        html_url: 'https://github.com/' + slug + '/issues/4', user: { login: 'owner' },
        state: 'open', created_at: timestamp, updated_at: timestamp, closed_at: null,
        comments: 0, labels: [], assignees: [],
      }];
    }
    return { body, headers: new Headers() };
  };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'driftguard-engineering-tasks-'));
  filename = join(directory, 'tasks.sqlite');
  db = openDatabase(filename);
  const registry = new RepositoryRegistry(db);
  const request = github('project', 2140);
  await registry.add(repo, false, request);
  await registry.add(otherRepo, false, github('other', 2141, false));
  await new IssueSync(db).sync(repo, request);
  tasks = new EngineeringTasks(db);
});

afterEach(() => {
  db.close();
  rmSync(filename, { force: true });
  rmdirSync(directory);
});

describe('engineering task persistence', () => {
  it('creates one task per real source record and retrieves the same task after reopening SQLite', () => {
    const task = tasks.createFromIssue(repo, 4, true);
    expect(task).toMatchObject({
      repositoryId: 2140, githubIssueId: 5040, githubIssueNumber: 4,
      sourceUrl: 'https://github.com/owner/project/issues/4', title: 'Check the exact candidate',
      description: originalBody, status: 'NEEDS_CLARIFICATION', assignedAgent: null, decisionId: null,
    });
    expect(tasks.createFromIssue(repo, 4)).toEqual(task);
    db.close();
    db = openDatabase(filename);
    tasks = new EngineeringTasks(db);
    expect(tasks.list(repo)).toEqual([task]);
    expect(tasks.inspect(repo, task.id)).toEqual(task);
  });

  it('requires a local issue in the selected repository and rejects disabled access', () => {
    expect(() => tasks.createFromIssue(repo, 99)).toThrow(expect.objectContaining({ code: 'ISSUE_NOT_FOUND' }));
    expect(() => tasks.createFromIssue(otherRepo, 4)).toThrow(expect.objectContaining({ code: 'ISSUE_NOT_FOUND' }));
    const task = tasks.createFromIssue(repo, 4);
    expect(task.status).toBe('DISCOVERED');
    expect(() => tasks.inspect(otherRepo, task.id)).toThrow(expect.objectContaining({ code: 'TASK_NOT_FOUND' }));
    new RepositoryRegistry(db).disable(repo);
    expect(() => tasks.list(repo)).toThrow(expect.objectContaining({ code: 'REPOSITORY_NOT_ALLOWED' }));
  });

  it('does not create a new task from a closed or unavailable issue', () => {
    db.prepare("UPDATE github_issues SET sync_state = 'CLOSED' WHERE repository_id = 2140").run();
    expect(() => tasks.createFromIssue(repo, 4)).toThrow(expect.objectContaining({ code: 'ISSUE_NOT_OPEN' }));
    db.prepare("UPDATE github_issues SET sync_state = 'UNAVAILABLE' WHERE repository_id = 2140").run();
    expect(() => tasks.createFromIssue(repo, 4)).toThrow(expect.objectContaining({ code: 'ISSUE_NOT_OPEN' }));
    expect(tasks.list(repo)).toEqual([]);
  });
});
