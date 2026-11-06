#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEnvironment } from '../config/env.js';
import { openDatabase } from '../db/database.js';
import { authenticatedGitHub, getGitHubIdentity, repositorySlug } from '../integrations/github/client.js';
import { GitHubError } from '../integrations/github/errors.js';
import { EngineeringTasks } from '../services/engineering-tasks.js';
import { IssueSync } from '../services/issue-sync.js';
import { RepositoryRegistry } from '../services/repository-registry.js';

const commands = {
  'auth status': { args: [], flags: [] },
  'repo list': { args: [], flags: [] },
  'repo add': { args: ['OWNER/REPO'], flags: ['write'] },
  'repo inspect': { args: ['OWNER/REPO'], flags: [] },
  'repo disable': { args: ['OWNER/REPO'], flags: [] },
  'issue sync': { args: ['OWNER/REPO'], flags: ['full'] },
  'issue list': { args: ['OWNER/REPO'], flags: ['all'] },
  'issue inspect': { args: ['OWNER/REPO', 'NUMBER'], flags: [] },
  'task create-from-issue': { args: ['OWNER/REPO', 'NUMBER'], flags: ['needs-clarification'] },
  'task list': { args: ['OWNER/REPO'], flags: [] },
  'task inspect': { args: ['OWNER/REPO', 'TASK_ID'], flags: [] },
} satisfies Record<string, { args: string[]; flags: string[] }>;

const usage = Object.entries(commands).map(([name, { args, flags }]) =>
  ['driftguard', name, ...args, ...flags.map((flag) => '[--' + flag + ']'), '[--json]'].join(' '),
);

function invalidArgument(message = 'Invalid command arguments. Use driftguard --help.'): never {
  throw new GitHubError('INVALID_ARGUMENT', message);
}

function parseCommand(argv: string[]) {
  try {
    return parseArgs({
      args: argv, allowPositionals: true,
      options: {
        json: { type: 'boolean' }, help: { type: 'boolean' }, write: { type: 'boolean' },
        full: { type: 'boolean' }, all: { type: 'boolean' }, 'needs-clarification': { type: 'boolean' },
      },
    });
  } catch {
    invalidArgument();
  }
}

function issueNumber(input: string): number {
  const number = Number(input);
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(number) || number < 1) invalidArgument('Use a positive issue number.');
  return number;
}

function taskId(input: string): string {
  const result = z.uuid().safeParse(input);
  if (!result.success) invalidArgument('Use a DriftGuard task UUID.');
  return result.data;
}

async function run(argv: string[]): Promise<unknown> {
  const { values, positionals } = parseCommand(argv);
  if (values.help || positionals.length === 0 && Object.keys(values).every((key) => key === 'json')) return { usage };

  const [group, action, ...args] = positionals;
  const name = group + ' ' + action;
  if (!Object.hasOwn(commands, name)) invalidArgument();
  const command = name as keyof typeof commands;
  const spec: { args: string[]; flags: string[] } = commands[command];
  if (args.length !== spec.args.length || Object.keys(values).some((key) => key !== 'json' && !spec.flags.includes(key))) {
    invalidArgument();
  }
  if (command === 'auth status') return getGitHubIdentity(await authenticatedGitHub());

  const repo = args[0] ? repositorySlug(args[0]) : '';
  const selector = args[1] ?? '';
  const db = openDatabase(loadEnvironment().DATABASE_PATH);
  try {
    const registry = new RepositoryRegistry(db);
    const issues = new IssueSync(db);
    const tasks = new EngineeringTasks(db);
    switch (command) {
      case 'repo list': return registry.list();
      case 'repo add': return await registry.add(repo, values.write === true, await authenticatedGitHub());
      case 'repo inspect': return registry.inspect(repo);
      case 'repo disable': return registry.disable(repo);
      case 'issue sync': {
        registry.readable(repo);
        return await issues.sync(repo, await authenticatedGitHub(), values.full === true);
      }
      case 'issue list': return issues.list(repo, values.all === true);
      case 'issue inspect': return issues.inspect(repo, issueNumber(selector));
      case 'task create-from-issue': return tasks.createFromIssue(repo, issueNumber(selector), values['needs-clarification']);
      case 'task list': return tasks.list(repo);
      case 'task inspect': return tasks.inspect(repo, taskId(selector));
    }
  } finally {
    db.close();
  }
}

const args = process.argv.slice(2);
const json = args.includes('--json');
try {
  const output = await run(args);
  process.stdout.write(JSON.stringify(output, null, json ? 0 : 2) + '\n');
} catch (error) {
  const known = error instanceof GitHubError;
  const code = known ? error.code : 'INTERNAL_ERROR';
  const message = known ? error.message : 'DriftGuard could not complete the command.';
  const retryAt = known ? error.retryAt : undefined;
  process.stderr.write((json ? JSON.stringify({ error: { code, message, retryAt } }) :
    code + ' ' + message + (retryAt ? ' Retry after ' + retryAt + '.' : '')) + '\n');
  process.exitCode = code === 'INVALID_ARGUMENT' ? 2 : 1;
}
