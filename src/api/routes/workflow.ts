import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  agentNames, evidenceReferencesSchema, handoffRequestSchema, taskVersionSchema, type HandoffEnvelope,
} from '../../domain/handoff.js';
import { switchHandoffArguments } from '../../integrations/switch/handoff.js';
import { repositorySchema, type WorkflowConfig, type WorkflowRole } from '../../security/workflow-auth.js';
import { WorkflowError, WorkflowService } from '../../services/workflow.js';
import { sendHttpError } from '../errors.js';

const proposalSchema = z.strictObject({
  repository: repositorySchema,
  summary: z.string().trim().min(1).max(4000),
  evidenceReferences: evidenceReferencesSchema,
});
const revisionSchema = taskVersionSchema.extend({ proposal: proposalSchema });
const buildAccessSchema = taskVersionSchema.extend({ repository: repositorySchema, correlationId: z.uuid() });
const taskPathSchema = z.strictObject({ taskId: z.uuid() });
const handoffPathSchema = z.strictObject({ correlationId: z.uuid() });

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new WorkflowError(400);
  return result.data;
}

function switchPayload(envelope: HandoffEnvelope) {
  return { envelope, switchArguments: switchHandoffArguments(envelope) };
}

type WorkflowHandler = (actor: WorkflowRole, request: FastifyRequest, reply: FastifyReply) => unknown;

export function registerWorkflowRoutes(app: FastifyInstance, db: Database, config: WorkflowConfig): void {
  const workflow = new WorkflowService(db, config.allowedRepositories);
  const authenticated = (handler: WorkflowHandler) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const actor = config.authenticate(request.headers.authorization);
    if (!actor) {
      reply.header('www-authenticate', 'Bearer');
      return sendHttpError(request, reply, 401);
    }
    return handler(actor, request, reply);
  };

  app.get('/api/v1/agents/me', authenticated((actor) => ({
    role: actor,
    agentName: actor === 'owner' ? null : agentNames[actor],
    repositoryAllowlist: actor === 'builder' || actor === 'owner' ? [...workflow.allowedRepositories] : [],
  })));
  app.get('/api/v1/tasks/:taskId', authenticated((_actor, request) => {
    return workflow.readTask(parseInput(taskPathSchema, request.params).taskId);
  }));
  app.post('/api/v1/tasks', authenticated((actor, request, reply) => {
    return reply.code(201).send(workflow.propose(actor, parseInput(proposalSchema, request.body)));
  }));
  app.post('/api/v1/tasks/:taskId/revise', authenticated((actor, request) => {
    const { taskId } = parseInput(taskPathSchema, request.params);
    const { decisionId, revision, proposal } = parseInput(revisionSchema, request.body);
    return workflow.revise(actor, { taskId, decisionId, revision }, proposal);
  }));
  app.post('/api/v1/tasks/:taskId/assign', authenticated((actor, request) => {
    const { taskId } = parseInput(taskPathSchema, request.params);
    return workflow.assign(actor, { taskId, ...parseInput(taskVersionSchema, request.body) });
  }));
  app.post('/api/v1/tasks/:taskId/build-access', authenticated((actor, request) => {
    const { taskId } = parseInput(taskPathSchema, request.params);
    const { decisionId, revision, repository, correlationId } = parseInput(buildAccessSchema, request.body);
    return workflow.authorizeBuild(actor, { taskId, decisionId, revision }, repository, correlationId);
  }));
  app.post('/api/v1/handoffs', authenticated((actor, request) => {
    return switchPayload(workflow.recordHandoff(actor, parseInput(handoffRequestSchema, request.body)));
  }));
  app.get('/api/v1/handoffs/:correlationId', authenticated((actor, request) => {
    const { correlationId } = parseInput(handoffPathSchema, request.params);
    return switchPayload(workflow.readHandoff(actor, correlationId));
  }));
}
