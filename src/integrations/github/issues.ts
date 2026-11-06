import { z } from 'zod';
import { parseResponse, repositorySlug, type GitHubRequest } from './client.js';
import { GitHubError } from './errors.js';

const integerId = z.int().positive();
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const user = z.object({ login: z.string() });
const issueResponse = z.object({
  id: integerId, number: integerId, title: z.string(), body: z.string().nullish(), html_url: z.string(),
  user: user.nullable(), state: z.enum(['open', 'closed']), created_at: timestamp, updated_at: timestamp,
  closed_at: timestamp.nullable(), comments: z.int().nonnegative(), assignees: z.array(user),
  labels: z.array(z.union([z.string(), z.object({ name: z.string() })])),
  pull_request: z.unknown().optional(),
});
const commentResponse = z.object({
  id: integerId, body: z.string(), user: user.nullable(), html_url: z.string(),
  created_at: timestamp, updated_at: timestamp,
});
const timelineEvent = z.object({ event: z.string(), source: z.unknown().optional() });
const pullRequestSource = z.object({
  issue: z.object({
    html_url: z.string().optional(),
    pull_request: z.object({ html_url: z.string().optional() }).optional(),
  }).nullish(),
});

export type IssueSummary = {
  githubIssueId: number;
  issueNumber: number;
  title: string;
  body: string | null;
  url: string;
  author: string | null;
  syncState: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  commentCount: number;
  labels: string[];
  assignees: string[];
};

export type IssueComment = {
  id: number; body: string; url: string; author: string | null; createdAt: string; updatedAt: string;
};

async function collectPages<T>(
  request: GitHubRequest, path: string, schema: z.ZodType<T>, filters: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= 10_000; page++) {
    const query = new URLSearchParams({ ...filters, per_page: '100', page: String(page) });
    const { body, headers } = await request(path + '?' + query.toString());
    for (const result of parseResponse(z.array(schema), body)) results.push(result);
    // Follow pagination by constructing the next request on the original repository path.
    if (!headers.get('link')?.includes('rel="next"')) return results;
  }
  throw new GitHubError('GITHUB_RESPONSE', 'GitHub pagination exceeded the safe page limit.');
}

function summarize(slug: string, issue: z.infer<typeof issueResponse>): IssueSummary | null {
  if (issue.pull_request !== undefined) return null;
  if (issue.html_url.toLowerCase() !== 'https://github.com/' + slug + '/issues/' + issue.number) {
    throw new GitHubError('REPOSITORY_CHANGED', 'GitHub returned an issue outside the registered repository.');
  }
  return {
    githubIssueId: issue.id, issueNumber: issue.number, title: issue.title, body: issue.body ?? null,
    url: issue.html_url, author: issue.user?.login ?? null, syncState: issue.state === 'open' ? 'OPEN' : 'CLOSED',
    createdAt: issue.created_at, updatedAt: issue.updated_at, closedAt: issue.closed_at,
    commentCount: issue.comments, labels: issue.labels.map((label) => typeof label === 'string' ? label : label.name).sort(),
    assignees: issue.assignees.map(({ login }) => login).sort(),
  };
}

export async function listOpenIssues(request: GitHubRequest, repository: string): Promise<IssueSummary[]> {
  const slug = repositorySlug(repository);
  const rows = await collectPages(request, '/repos/' + slug + '/issues', issueResponse, {
    state: 'open', sort: 'created', direction: 'asc',
  });
  return rows.flatMap((issue) => summarize(slug, issue) ?? []);
}

function issuePath(slug: string, issueNumber: number): string {
  if (!integerId.safeParse(issueNumber).success) throw new GitHubError('INVALID_ARGUMENT', 'Use a positive issue number.');
  return '/repos/' + slug + '/issues/' + issueNumber;
}

export async function getIssue(request: GitHubRequest, repository: string, issueNumber: number): Promise<IssueSummary | null> {
  const slug = repositorySlug(repository);
  const path = issuePath(slug, issueNumber);
  let body: unknown;
  try {
    ({ body } = await request(path));
  } catch (error) {
    if (error instanceof GitHubError && ['GITHUB_NOT_FOUND', 'REPOSITORY_CHANGED'].includes(error.code)) return null;
    throw error;
  }
  const issue = summarize(slug, parseResponse(issueResponse, body));
  if (issue && issue.issueNumber !== issueNumber) {
    throw new GitHubError('REPOSITORY_CHANGED', 'GitHub returned a different issue number.');
  }
  return issue;
}

export async function listIssueComments(request: GitHubRequest, repository: string, issueNumber: number): Promise<IssueComment[]> {
  const slug = repositorySlug(repository);
  const comments = await collectPages(request, issuePath(slug, issueNumber) + '/comments', commentResponse);
  const unique = new Map<number, IssueComment>();
  for (const comment of comments) {
    if (comment.html_url.toLowerCase() !== 'https://github.com/' + slug + '/issues/' + issueNumber + '#issuecomment-' + comment.id) {
      throw new GitHubError('REPOSITORY_CHANGED', 'GitHub returned a comment outside the registered issue.');
    }
    const previous = unique.get(comment.id);
    if (previous && previous.updatedAt > comment.updated_at) continue;
    unique.set(comment.id, {
      id: comment.id, body: comment.body, url: comment.html_url, author: comment.user?.login ?? null,
      createdAt: comment.created_at, updatedAt: comment.updated_at,
    });
  }
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

export async function listIssuePullRequests(request: GitHubRequest, repository: string, issueNumber: number): Promise<string[]> {
  const events = await collectPages(
    request, issuePath(repositorySlug(repository), issueNumber) + '/timeline', timelineEvent,
  );
  const links = new Set<string>();
  for (const event of events) {
    if (event.event !== 'cross-referenced') continue;
    const parsed = pullRequestSource.safeParse(event.source);
    const source = parsed.data?.issue;
    if (!source?.pull_request) continue;
    const url = source.pull_request.html_url ?? source.html_url;
    if (url && /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/[1-9]\d*$/i.test(url)) links.add(url);
  }
  return [...links].sort();
}
