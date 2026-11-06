import { handoffEnvelopeSchema, type HandoffEnvelope } from '../../domain/handoff.js';

export function serializeHandoff(envelope: HandoffEnvelope): string {
  // Switch recognizes mentions anywhere in message text, including in evidence URLs.
  return JSON.stringify(handoffEnvelopeSchema.parse(envelope)).replaceAll('@', '\\u0040');
}

export function switchHandoffArguments(envelope: HandoffEnvelope) {
  return { body: serializeHandoff(envelope), target_names: [envelope.targetAgent] };
}
