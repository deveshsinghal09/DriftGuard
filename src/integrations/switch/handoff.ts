import { handoffEnvelopeSchema, type HandoffEnvelope } from '../../domain/handoff.js';

export function serializeHandoff(envelope: HandoffEnvelope): string {
  return JSON.stringify(handoffEnvelopeSchema.parse(envelope));
}
