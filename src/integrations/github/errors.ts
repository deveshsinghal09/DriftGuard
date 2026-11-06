export type GitHubErrorCode =
  | 'INVALID_ARGUMENT' | 'GITHUB_AUTH' | 'GITHUB_FORBIDDEN' | 'GITHUB_RATE_LIMIT'
  | 'GITHUB_NETWORK' | 'GITHUB_RESPONSE' | 'GITHUB_NOT_FOUND' | 'REPOSITORY_CHANGED'
  | 'REPOSITORY_NOT_ALLOWED' | 'REPOSITORY_NOT_OWNED' | 'REPOSITORY_WRITE_DENIED'
  | 'ISSUES_DISABLED' | 'SYNC_CONFLICT' | 'ISSUE_NOT_FOUND' | 'ISSUE_NOT_OPEN' | 'TASK_NOT_FOUND';

export class GitHubError extends Error {
  constructor(readonly code: GitHubErrorCode, message: string, readonly retryAt?: string) {
    super(message);
  }
}
