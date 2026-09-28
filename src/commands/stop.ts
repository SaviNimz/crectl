import type { Command } from 'commander';
import prompts from 'prompts';
import { selectRunningProcess } from '../lib/targetResolver.js';
import { stopProcess } from '../lib/processControl.js';

function register(program: Command): void {
  program
    .command('stop <target>')
    .description('Stop a single running WSO2 product (PID or product-name match)')
    .option('-y, --yes', 'skip confirmation prompt')
    .option('--force', 'skip graceful shutdown, SIGKILL immediately')
    .option('--dry-run', 'show what would be stopped without doing it')
    .option('--timeout <seconds>', 'graceful shutdown timeout in seconds', '15')
    .action(async (target: string, opts) => {
      const chosen = await selectRunningProcess(target);
      if (!chosen) return;

      console.log(`Will stop ${chosen.product} ${chosen.version} (PID ${chosen.pid}).`);
      if (!opts.yes && !opts.dryRun) {
        const confirm = await prompts({ type: 'confirm', name: 'ok', message: 'Proceed?', initial: false });
        if (!confirm.ok) {
          console.log('Cancelled.');
          return;
        }
      }

      const result = await stopProcess(chosen.pid, {
        force: opts.force,
        dryRun: opts.dryRun,
        timeoutMs: Number(opts.timeout) * 1000,
      });
      console.log(`${chosen.product} ${chosen.version} (PID ${chosen.pid}): ${result}`);
    });
}

export default { register };
