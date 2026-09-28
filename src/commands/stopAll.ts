import type { Command } from 'commander';
import prompts from 'prompts';
import { scanWso2Processes } from '../lib/processScan.js';
import { stopProcess } from '../lib/processControl.js';
import { printTable } from '../lib/format.js';

function register(program: Command): void {
  program
    .command('stop-all')
    .description('Stop every running WSO2 product')
    .option('-y, --yes', 'skip confirmation prompt')
    .option('--force', 'skip graceful shutdown, SIGKILL immediately')
    .option('--dry-run', 'show what would be stopped without doing it')
    .option('--timeout <seconds>', 'graceful shutdown timeout in seconds', '15')
    .action(async (opts) => {
      const processes = scanWso2Processes();
      if (processes.length === 0) {
        console.log('No WSO2 products running.');
        return;
      }

      printTable(
        ['PID', 'PRODUCT', 'VERSION', 'UPTIME'],
        processes.map((p) => [String(p.pid), p.product, p.version || '-', p.etime])
      );

      if (!opts.yes && !opts.dryRun) {
        const confirm = await prompts({
          type: 'confirm',
          name: 'ok',
          message: `Stop all ${processes.length} running WSO2 product(s) above?`,
          initial: false,
        });
        if (!confirm.ok) {
          console.log('Cancelled.');
          return;
        }
      }

      for (const p of processes) {
        const result = await stopProcess(p.pid, {
          force: opts.force,
          dryRun: opts.dryRun,
          timeoutMs: Number(opts.timeout) * 1000,
        });
        console.log(`${p.product} ${p.version} (PID ${p.pid}): ${result}`);
      }
    });
}

export default { register };
