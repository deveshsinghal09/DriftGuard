import { STATUS_CODES } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function sendHttpError(request: FastifyRequest, reply: FastifyReply, status: number) {
  return reply.code(status).send({
    error: {
      code: `HTTP_${status}`,
      message: STATUS_CODES[status] ?? 'Request failed',
      requestId: request.id,
    },
  });
}
