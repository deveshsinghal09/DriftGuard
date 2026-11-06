import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WorkflowConfig, WorkflowRole } from '../security/workflow-auth.js';
import { sendHttpError } from './errors.js';

type WorkflowHandler = (actor: WorkflowRole, request: FastifyRequest, reply: FastifyReply) => unknown;

export function workflowAuthentication(config: WorkflowConfig) {
  return (handler: WorkflowHandler) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const actor = config.authenticate(request.headers.authorization);
    if (!actor) {
      reply.header('www-authenticate', 'Bearer');
      return sendHttpError(request, reply, 401);
    }
    return handler(actor, request, reply);
  };
}
