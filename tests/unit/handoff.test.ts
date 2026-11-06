import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handoffEnvelopeSchema, handoffRequestSchema, type HandoffEnvelope } from '../../src/domain/handoff.js';
import { serializeHandoff } from '../../src/integrations/switch/handoff.js';

const envelope: HandoffEnvelope = {
  taskId: randomUUID(),
  decisionId: randomUUID(),
  revision: 3,
  sourceAgent: 'driftguard-builder',
  targetAgent: 'driftguard-verifier',
  action: 'request_verification',
  status: 'ready_for_verification',
  candidateSha: 'a'.repeat(40),
  evidenceReferences: ['switch:room-message', 'git:candidate-check'],
  correlationId: randomUUID(),
  timestamp: '2026-11-06T09:30:00.000Z',
};

describe('Switch handoff serialization', () => {
  it('round-trips the complete envelope as JSON message text', () => {
    expect(handoffEnvelopeSchema.parse(JSON.parse(serializeHandoff(envelope)))).toEqual(envelope);
  });

  it.each([
    { taskId: 'missing-task' },
    { decisionId: 'missing-decision' },
    { revision: 0 },
    { sourceAgent: 'driftguard-guardian' },
    { targetAgent: 'driftguard-builder' },
    { status: 'verified' },
    { candidateSha: undefined },
    { evidenceReferences: [] },
    { timestamp: 'yesterday' },
  ])('rejects an invalid handoff %#', (changes) => {
    expect(handoffEnvelopeSchema.safeParse({ ...envelope, ...changes }).success).toBe(false);
  });

  it('rejects an agent-supplied identity or unsupported action in a request', () => {
    const { taskId, decisionId, revision, correlationId, evidenceReferences } = envelope;
    const request = { taskId, decisionId, revision, correlationId, evidenceReferences, action: 'request_build' };
    expect(handoffRequestSchema.safeParse(request).success).toBe(true);
    expect(handoffRequestSchema.safeParse({ ...request, sourceAgent: envelope.sourceAgent }).success).toBe(false);
    expect(handoffRequestSchema.safeParse({ ...request, action: 'merge' }).success).toBe(false);
  });
});
