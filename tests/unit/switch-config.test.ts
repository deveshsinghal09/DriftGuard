import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const roleNames = ['guardian', 'builder', 'verifier'];
const requiredSections = [
  'Purpose and role', 'Tools available', 'Allowed actions', 'Forbidden actions',
  'How to read project state', 'When to respond', 'Expected output', 'Error handling',
  'Human escalation', 'Handoff procedure', 'Evidence requirements',
];

describe('Switch agent and room configuration', () => {
  it.each(roleNames)('provides complete instructions for %s', (role) => {
    const filename = new URL('../../switch/agents/' + role + '.md', import.meta.url);
    const content = readFileSync(filename, 'utf8');
    const sections = [...content.matchAll(/^## (.+)\r?$/gm)].map((match) => match[1]);

    expect(content.split(/\r?\n/, 1)[0]).toBe('# driftguard-' + role);
    expect(sections).toEqual(requiredSections);
    expect(content).toContain('send_targeted_message');
  });

  it('uses the documented room template fields with private access and explicit participants', () => {
    const filename = new URL('../../switch/templates/driftguard-engineering.template.yaml', import.meta.url);
    const template: unknown = parse(readFileSync(filename, 'utf8'));
    expect(template).toEqual({
      version: 1,
      params: { messaging_app: { type: 'bridge', label: 'Messaging app', default: ['Mattermost'] } },
      room: {
        name: 'driftguard-engineering',
        description: expect.any(String),
        bridge: '{messaging_app}',
        channel_type: 'channel_private',
        read_visibility: 'private',
        write_visibility: 'private',
        agents: roleNames.map((role) => 'driftguard-' + role),
        users: ['{$creator}'],
        instructions: expect.stringContaining('persistent task ID'),
      },
    });
  });
});
