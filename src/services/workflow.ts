import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  agentNames, evidenceReferencesSchema, handoffEnvelopeSchema, handoffRoles,
  type HandoffEnvelope, type HandoffRequest, type TaskReference,
} from '../domain/handoff.js';
import { serializeHandoff } from '../integrations/switch/handoff.js';
import type { WorkflowRole } from '../security/workflow-auth.js';

type TaskStatus = 'proposed' | HandoffEnvelope['status'];
type Proposal = { repository: string; summary: string; evidenceReferences: string[] };
type Task = TaskReference & Proposal & { status: TaskStatus; candidateSha: string | null };
type StoredTask = Omit<Task, 'evidenceReferences'> & { evidenceReferences: string };
type StoredHandoff = { envelope: string; requestHash: string };

export class WorkflowError extends Error {
  constructor(readonly statusCode: 400 | 403 | 404 | 409) {
    super('Workflow request rejected');
  }
}

function requireRole(actor: WorkflowRole, expected: WorkflowRole): void {
  if (actor !== expected) throw new WorkflowError(403);
}

export class WorkflowService {
  constructor(private readonly db: Database, private readonly allowedRepositories: ReadonlySet<string>) {}

  repositoriesForBuild(): string[] {
    return [...this.allowedRepositories].filter((repository) => this.repositoryAllowed(repository));
  }

  readTask(taskId: string): Task {
    const row = this.db.prepare<[string], StoredTask>(`
      SELECT task_id AS taskId, decision_id AS decisionId, revision, repository, summary, status,
             candidate_sha AS candidateSha, evidence_references AS evidenceReferences
      FROM workflow_tasks WHERE task_id = ?
    `).get(taskId);
    if (!row) throw new WorkflowError(404);

    return { ...row, evidenceReferences: evidenceReferencesSchema.parse(JSON.parse(row.evidenceReferences)) };
  }

  propose(actor: WorkflowRole, proposal: Proposal): Task {
    requireRole(actor, 'guardian');
    const taskId = randomUUID();
    const decisionId = randomUUID();
    this.db.prepare(`
      INSERT INTO workflow_tasks (task_id, decision_id, revision, repository, summary, evidence_references, status)
      VALUES (?, ?, 1, ?, ?, ?, 'proposed')
    `).run(taskId, decisionId, proposal.repository, proposal.summary, JSON.stringify(proposal.evidenceReferences));
    return this.readTask(taskId);
  }

  revise(actor: WorkflowRole, reference: TaskReference, proposal: Proposal): Task {
    requireRole(actor, 'guardian');
    return this.db.transaction(() => {
      const task = this.requireCurrentTask(reference);
      if (task.status !== 'proposed' && task.status !== 'changes_requested') throw new WorkflowError(409);

      this.db.prepare(`
        UPDATE workflow_tasks SET revision = revision + 1, repository = ?, summary = ?, evidence_references = ?,
          status = 'proposed', candidate_sha = NULL WHERE task_id = ?
      `).run(proposal.repository, proposal.summary, JSON.stringify(proposal.evidenceReferences), task.taskId);
      return this.readTask(task.taskId);
    }).immediate();
  }

  assign(actor: WorkflowRole, reference: TaskReference): Task {
    requireRole(actor, 'owner');
    return this.db.transaction(() => {
      const task = this.requireCurrentTask(reference);
      this.requireAllowlisted(task.repository);
      if (task.status !== 'proposed') throw new WorkflowError(409);

      this.db.prepare("UPDATE workflow_tasks SET status = 'assigned' WHERE task_id = ?").run(task.taskId);
      return this.readTask(task.taskId);
    }).immediate();
  }

  authorizeBuild(actor: WorkflowRole, reference: TaskReference, repository: string, correlationId: string): Task {
    requireRole(actor, 'builder');
    return this.db.transaction(() => {
      const task = this.requireCurrentTask(reference);
      this.requireAllowlisted(task.repository);
      if (repository !== task.repository) throw new WorkflowError(403);
      if (task.status !== 'assigned') throw new WorkflowError(409);
      const dispatch = this.db.prepare(`
        SELECT 1 FROM workflow_handoffs
        WHERE correlation_id = ? AND task_id = ? AND revision = ? AND action = 'request_build'
      `).get(correlationId, task.taskId, task.revision);
      if (!dispatch) throw new WorkflowError(409);

      return task;
    })();
  }

  recordHandoff(actor: WorkflowRole, request: HandoffRequest): HandoffEnvelope {
    const roles = handoffRoles[request.action];
    requireRole(actor, roles.source);
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');

    return this.db.transaction(() => {
      const existing = this.findHandoff(request.correlationId);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new WorkflowError(409);
        return handoffEnvelopeSchema.parse(JSON.parse(existing.envelope));
      }

      const task = this.requireCurrentTask(request);
      this.requireAllowlisted(task.repository);
      const priorAction = this.db.prepare(`
        SELECT 1 FROM workflow_handoffs WHERE task_id = ? AND revision = ? AND action = ?
      `).get(task.taskId, task.revision, request.action);
      if (priorAction) throw new WorkflowError(409);

      const status = this.applyHandoff(task, request);
      const envelope: HandoffEnvelope = {
        taskId: task.taskId,
        decisionId: task.decisionId,
        revision: task.revision,
        sourceAgent: agentNames[roles.source],
        targetAgent: agentNames[roles.target],
        action: request.action,
        status,
        evidenceReferences: request.evidenceReferences,
        correlationId: request.correlationId,
        timestamp: new Date().toISOString(),
        ...('candidateSha' in request ? { candidateSha: request.candidateSha } : {}),
      };
      this.db.prepare(`
        INSERT INTO workflow_handoffs (correlation_id, task_id, revision, action, request_hash, envelope)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(request.correlationId, task.taskId, task.revision, request.action, requestHash, serializeHandoff(envelope));
      return envelope;
    }).immediate();
  }

  readHandoff(actor: WorkflowRole, correlationId: string): HandoffEnvelope {
    const stored = this.findHandoff(correlationId);
    if (!stored) throw new WorkflowError(404);

    const envelope = handoffEnvelopeSchema.parse(JSON.parse(stored.envelope));
    const roles = handoffRoles[envelope.action];
    if (actor !== 'owner' && actor !== roles.source && actor !== roles.target) throw new WorkflowError(403);
    return envelope;
  }

  private requireCurrentTask(reference: TaskReference): Task {
    const task = this.readTask(reference.taskId);
    if (task.decisionId !== reference.decisionId || task.revision !== reference.revision) throw new WorkflowError(409);
    return task;
  }

  private requireAllowlisted(repository: string): void {
    if (!this.repositoryAllowed(repository)) throw new WorkflowError(403);
  }

  private repositoryAllowed(repository: string): boolean {
    if (!this.allowedRepositories.has(repository)) return false;
    const blocked = this.db.prepare(`
      SELECT 1 FROM github_repositories WHERE slug = ? AND (active = 0 OR write_enabled = 0)
    `).get(repository);
    return !blocked;
  }

  private findHandoff(correlationId: string): StoredHandoff | undefined {
    return this.db.prepare<[string], StoredHandoff>(`
      SELECT envelope, request_hash AS requestHash FROM workflow_handoffs WHERE correlation_id = ?
    `).get(correlationId);
  }

  private applyHandoff(task: Task, request: HandoffRequest): HandoffEnvelope['status'] {
    switch (request.action) {
      case 'request_build':
        if (task.status !== 'assigned') throw new WorkflowError(409);
        return 'assigned';
      case 'request_verification': {
        const dispatch = this.db.prepare(`
          SELECT 1 FROM workflow_handoffs WHERE task_id = ? AND revision = ? AND action = 'request_build'
        `).get(task.taskId, task.revision);
        if (task.status !== 'assigned' || !dispatch) throw new WorkflowError(409);
        this.db.prepare("UPDATE workflow_tasks SET status = 'ready_for_verification', candidate_sha = ? WHERE task_id = ?")
          .run(request.candidateSha, task.taskId);
        return 'ready_for_verification';
      }
      case 'report_verification':
        if (task.status !== 'ready_for_verification' || task.candidateSha !== request.candidateSha) {
          throw new WorkflowError(409);
        }
        this.db.prepare('UPDATE workflow_tasks SET status = ? WHERE task_id = ?').run(request.verdict, task.taskId);
        return request.verdict;
    }
  }
}
