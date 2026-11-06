import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app/build-app.js';
import { parseEnvironment } from '../../src/config/env.js';
import type { TaskReference } from '../../src/domain/handoff.js';
import { configureWorkflow, type WorkflowRole } from '../../src/security/workflow-auth.js';

const tokens = {
  owner: randomBytes(32).toString('base64url'),
  guardian: randomBytes(32).toString('base64url'),
  builder: randomBytes(32).toString('base64url'),
  verifier: randomBytes(32).toString('base64url'),
};
const credentials = {
  WORKFLOW_OWNER_TOKEN: tokens.owner,
  WORKFLOW_GUARDIAN_TOKEN: tokens.guardian,
  WORKFLOW_BUILDER_TOKEN: tokens.builder,
  WORKFLOW_VERIFIER_TOKEN: tokens.verifier,
};
const proposal = {
  repository: 'Example/Project',
  summary: 'Resolve the competing acceptance criteria.',
  evidenceReferences: ['switch:proposal-thread'],
};
const candidateSha = 'a'.repeat(40);

let directory: string;
let databasePath: string;
let app: ReturnType<typeof buildApp>;

function createApp(allowlist: string) {
  return buildApp(parseEnvironment({ DATABASE_PATH: databasePath, LOG_LEVEL: 'silent' }), configureWorkflow({
    ...credentials,
    WORKFLOW_ALLOWED_REPOS: allowlist,
  }, '127.0.0.1'));
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'driftguard-workflow-'));
  databasePath = join(directory, 'workflow.sqlite');
  app = createApp(proposal.repository);
});

afterEach(async () => {
  try {
    await app.close();
  } finally {
    rmSync(databasePath, { force: true });
    rmdirSync(directory);
  }
});

function send(method: 'GET' | 'POST', url: string, role?: WorkflowRole, payload?: Record<string, unknown>) {
  return app.inject({
    method, url: '/api/v1' + url,
    ...(role ? { headers: { authorization: 'Bearer ' + tokens[role] } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function propose(repository = proposal.repository): Promise<TaskReference> {
  const response = await send('POST', '/tasks', 'guardian', { ...proposal, repository });
  expect(response.statusCode).toBe(201);
  const { taskId, decisionId, revision } = response.json<TaskReference>();
  return { taskId, decisionId, revision };
}

function taskRoute(task: TaskReference, action = '') {
  return '/tasks/' + task.taskId + action;
}

function assign(task: TaskReference, role: WorkflowRole = 'owner') {
  return send('POST', taskRoute(task, '/assign'), role, { decisionId: task.decisionId, revision: task.revision });
}

function handoff(task: TaskReference, action: string, extra: Record<string, unknown> = {}) {
  return { ...task, action, correlationId: randomUUID(), evidenceReferences: ['switch:task-thread'], ...extra };
}

function buildAccess(task: TaskReference, correlationId: string, repository = proposal.repository) {
  return send('POST', taskRoute(task, '/build-access'), 'builder', {
    decisionId: task.decisionId, revision: task.revision, correlationId, repository,
  });
}

describe('workflow authentication and role boundaries', () => {
  it('rejects absent or invalid credentials and resolves roles server-side', async () => {
    const anonymous = await send('GET', '/agents/me');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['www-authenticate']).toBe('Bearer');
    expect((await app.inject({
      url: '/api/v1/agents/me', headers: { authorization: 'Bearer ' + randomBytes(32).toString('base64url') },
    })).statusCode).toBe(401);
    expect((await send('GET', '/agents/me', 'builder')).json()).toEqual({
      role: 'builder', agentName: 'driftguard-builder', repositoryAllowlist: ['example/project'],
    });
    expect((await send('GET', '/agents/me', 'verifier')).json().repositoryAllowlist).toEqual([]);
  });

  it('denies self-approval and cross-role handoffs', async () => {
    expect((await send('POST', '/tasks', 'builder', proposal)).statusCode).toBe(403);
    const task = await propose();
    for (const role of ['guardian', 'builder', 'verifier'] as const) {
      expect((await assign(task, role)).statusCode).toBe(403);
    }
    expect((await send('POST', '/handoffs', 'builder', handoff(task, 'report_verification', {
      candidateSha, verdict: 'verified',
    }))).statusCode).toBe(403);
    expect((await send('POST', '/handoffs', 'verifier', handoff(task, 'request_build'))).statusCode).toBe(403);
    expect((await send('POST', '/handoffs', 'guardian', handoff(task, 'request_verification', {
      candidateSha,
    }))).statusCode).toBe(403);
    expect((await send('POST', '/handoffs', 'guardian', handoff(task, 'request_build'))).statusCode).toBe(409);
    expect((await send('GET', taskRoute(task), 'owner')).json().status).toBe('proposed');
  });

  it('blocks out-of-scope repositories and requires the recorded Guardian dispatch', async () => {
    expect((await assign(await propose('outside/other'))).statusCode).toBe(403);
    const task = await propose();
    expect((await assign(task)).statusCode).toBe(200);
    expect((await buildAccess(task, randomUUID())).statusCode).toBe(409);
    expect((await send('POST', '/handoffs', 'builder', handoff(task, 'request_verification', {
      candidateSha,
    }))).statusCode).toBe(409);

    const dispatch = handoff(task, 'request_build');
    expect((await send('POST', '/handoffs', 'guardian', dispatch)).statusCode).toBe(200);
    expect((await buildAccess(task, dispatch.correlationId, 'outside/other')).statusCode).toBe(403);
    expect((await buildAccess(task, dispatch.correlationId)).statusCode).toBe(200);

    await app.close();
    app = createApp('');
    expect((await buildAccess(task, dispatch.correlationId)).statusCode).toBe(403);
  });

  it('rejects missing, mismatched and stale task references', async () => {
    const task = await propose();
    expect((await assign({ ...task, taskId: randomUUID() })).statusCode).toBe(404);
    expect((await assign({ ...task, decisionId: randomUUID() })).statusCode).toBe(409);
    expect((await assign({ ...task, revision: 2 })).statusCode).toBe(409);
    expect((await send('POST', '/handoffs', 'guardian', handoff(task, 'request_build', {
      taskId: 'invalid',
    }))).statusCode).toBe(400);
  });
});

describe('persistent Switch handoffs', () => {
  it('persists identities and receipts across restart and retries a correlation id safely', async () => {
    const task = await propose();
    expect((await assign(task)).statusCode).toBe(200);
    const dispatch = handoff(task, 'request_build');
    const recorded = await send('POST', '/handoffs', 'guardian', dispatch);
    expect(recorded.statusCode).toBe(200);
    const payload = recorded.json();
    expect(JSON.parse(payload.switchArguments.body)).toEqual(payload.envelope);
    expect(payload.switchArguments.target_names).toEqual(['driftguard-builder']);
    expect(payload.envelope).toMatchObject({
      ...task, sourceAgent: 'driftguard-guardian', targetAgent: 'driftguard-builder', status: 'assigned',
    });

    await app.close();
    app = createApp(proposal.repository);
    expect((await send('GET', taskRoute(task), 'builder')).json()).toMatchObject(task);
    const inbox = '/handoffs/' + dispatch.correlationId;
    expect((await send('GET', inbox, 'builder')).json()).toEqual(payload);
    expect((await send('GET', inbox, 'verifier')).statusCode).toBe(403);
    expect((await send('POST', '/handoffs', 'guardian', dispatch)).json()).toEqual(payload);
    expect((await send('POST', '/handoffs', 'guardian', {
      ...dispatch, evidenceReferences: ['switch:different-message'],
    })).statusCode).toBe(409);
    expect((await send('POST', '/handoffs', 'guardian', handoff(task, 'request_build'))).statusCode).toBe(409);
  });

  it('binds an independent verdict to the candidate and requires fresh approval after revision', async () => {
    const task = await propose();
    expect((await assign(task)).statusCode).toBe(200);
    const dispatch = handoff(task, 'request_build');
    expect((await send('POST', '/handoffs', 'guardian', dispatch)).statusCode).toBe(200);
    const candidate = await send('POST', '/handoffs', 'builder', handoff(task, 'request_verification', { candidateSha }));
    expect(candidate.statusCode).toBe(200);
    expect(candidate.json().envelope).toMatchObject({
      targetAgent: 'driftguard-verifier', status: 'ready_for_verification', candidateSha,
    });

    const report = handoff(task, 'report_verification', { candidateSha, verdict: 'changes_requested' });
    expect((await send('POST', '/handoffs', 'verifier', {
      ...report, candidateSha: 'b'.repeat(40),
    })).statusCode).toBe(409);
    expect((await send('POST', '/handoffs', 'verifier', report)).json().envelope).toMatchObject({
      sourceAgent: 'driftguard-verifier', targetAgent: 'driftguard-guardian', status: 'changes_requested', candidateSha,
    });
    const revised = await send('POST', taskRoute(task, '/revise'), 'guardian', {
      decisionId: task.decisionId, revision: task.revision, proposal,
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({ ...task, revision: 2, status: 'proposed', candidateSha: null });
    expect((await buildAccess(task, dispatch.correlationId)).statusCode).toBe(409);
    expect((await assign({ ...task, revision: 2 })).statusCode).toBe(200);
    expect((await buildAccess({ ...task, revision: 2 }, dispatch.correlationId)).statusCode).toBe(409);

    const updatedTask = { ...task, revision: 2 };
    expect((await send('POST', '/handoffs', 'guardian', handoff(updatedTask, 'request_build'))).statusCode).toBe(200);
    expect((await send('POST', '/handoffs', 'builder', handoff(updatedTask, 'request_verification', {
      candidateSha,
    }))).statusCode).toBe(200);
    expect((await send('POST', '/handoffs', 'verifier', handoff(updatedTask, 'report_verification', {
      candidateSha, verdict: 'verified',
    }))).statusCode).toBe(200);
    expect((await send('GET', taskRoute(updatedTask), 'owner')).json().status).toBe('verified');
  });
});

describe('workflow startup configuration', () => {
  it('disables the workflow without configuration and refuses unsafe credentials or bind addresses', () => {
    expect(configureWorkflow({}, '127.0.0.1')).toBeUndefined();
    expect(() => configureWorkflow({ WORKFLOW_OWNER_TOKEN: tokens.owner }, '127.0.0.1')).toThrow('distinct');
    expect(() => configureWorkflow({
      ...credentials, WORKFLOW_GUARDIAN_TOKEN: tokens.owner,
    }, '127.0.0.1')).toThrow('distinct');
    expect(() => configureWorkflow(credentials, '0.0.0.0')).toThrow('loopback');
    expect(() => configureWorkflow({
      ...credentials, WORKFLOW_ALLOWED_REPOS: 'https://example.com/owner/repo',
    }, '127.0.0.1')).toThrow('owner/repo');
  });
});
