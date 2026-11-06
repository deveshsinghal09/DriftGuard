export const engineeringTaskStatuses = [
  'DISCOVERED', 'NEEDS_CLARIFICATION', 'AWAITING_APPROVAL', 'READY', 'IN_PROGRESS',
  'IN_REVIEW', 'VERIFIED', 'BLOCKED', 'COMPLETED', 'FAILED',
] as const;

export type EngineeringTaskStatus = typeof engineeringTaskStatuses[number];

export interface EngineeringTask {
  id: string;
  repositoryId: number;
  githubIssueId: number;
  githubIssueNumber: number;
  sourceUrl: string;
  title: string;
  description: string | null;
  status: EngineeringTaskStatus;
  assignedAgent: string | null;
  decisionId: string | null;
  createdAt: string;
  updatedAt: string;
}
