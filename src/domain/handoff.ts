import { z } from 'zod';

export const agentNames = {
  guardian: 'driftguard-guardian',
  builder: 'driftguard-builder',
  verifier: 'driftguard-verifier',
} as const;

export type AgentRole = keyof typeof agentNames;

export const handoffRoles = {
  request_build: { source: 'guardian', target: 'builder', statuses: ['assigned'] },
  request_verification: { source: 'builder', target: 'verifier', statuses: ['ready_for_verification'] },
  report_verification: { source: 'verifier', target: 'guardian', statuses: ['verified', 'changes_requested'] },
} as const;

export const taskVersionSchema = z.strictObject({ decisionId: z.uuid(), revision: z.int().positive() });
export const taskReferenceSchema = taskVersionSchema.extend({ taskId: z.uuid() });
export const evidenceReferencesSchema = z.array(
  z.string().trim().min(1).max(300).regex(/^[^\u0000-\u001f\u007f]+$/u),
).min(1).max(10);
const candidateShaSchema = z.string().regex(/^[0-9a-f]{40}$/i).transform((sha) => sha.toLowerCase());
const verificationVerdictSchema = z.enum(['verified', 'changes_requested']);
const handoffReferenceSchema = taskReferenceSchema.extend({
  correlationId: z.uuid(),
  evidenceReferences: evidenceReferencesSchema,
});

export const handoffRequestSchema = z.discriminatedUnion('action', [
  handoffReferenceSchema.extend({ action: z.literal('request_build') }),
  handoffReferenceSchema.extend({ action: z.literal('request_verification'), candidateSha: candidateShaSchema }),
  handoffReferenceSchema.extend({
    action: z.literal('report_verification'),
    candidateSha: candidateShaSchema,
    verdict: verificationVerdictSchema,
  }),
]);

const agentNameSchema = z.enum(agentNames);
export const handoffEnvelopeSchema = handoffReferenceSchema.extend({
  sourceAgent: agentNameSchema,
  targetAgent: agentNameSchema,
  action: z.enum(['request_build', 'request_verification', 'report_verification']),
  status: z.enum(['assigned', 'ready_for_verification', ...verificationVerdictSchema.options]),
  candidateSha: candidateShaSchema.optional(),
  timestamp: z.iso.datetime(),
}).refine((envelope) => {
  const roles = handoffRoles[envelope.action];
  const statuses: readonly string[] = roles.statuses;
  const requiresCandidate = envelope.action !== 'request_build';
  return envelope.sourceAgent === agentNames[roles.source] && envelope.targetAgent === agentNames[roles.target]
    && statuses.includes(envelope.status) && requiresCandidate === (envelope.candidateSha !== undefined);
}, 'Handoff agents, status, or candidate do not match its action');

export type TaskReference = z.infer<typeof taskReferenceSchema>;
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type HandoffEnvelope = z.infer<typeof handoffEnvelopeSchema>;
