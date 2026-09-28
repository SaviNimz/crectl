import type { Command } from 'commander';
import { printTable } from '../lib/format.js';

interface CommandRow {
  name: string;
  description: string;
}

function commandArgs(cmd: Command): string {
  return cmd.usage().replace('[options]', '').trim();
}

function flattenCommands(cmd: Command, prefix: string[] = []): CommandRow[] {
  const rows: CommandRow[] = [];
  for (const sub of cmd.commands) {
    const nameChain = [...prefix, sub.name()];
    if (sub.commands.length > 0) {
      rows.push(...flattenCommands(sub, nameChain));
      continue;
    }
    const args = commandArgs(sub);
    rows.push({
      name: args ? `${nameChain.join(' ')} ${args}` : nameChain.join(' '),
      description: sub.description() || '-',
    });
  }
  return rows;
}

function register(program: Command): void {
  program
    .command('list')
    .description('List all available crectl commands')
    .action(() => {
      const rows = flattenCommands(program).sort((a, b) => a.name.localeCompare(b.name));
      printTable(
        ['COMMAND', 'DESCRIPTION'],
        rows.map((r) => [r.name, r.description])
      );
    });
}

export default { register };
