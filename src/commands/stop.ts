import type { Command } from 'commander';
import prompts from 'prompts';
import { scanWso2Processes } from '../lib/processScan.js';
import { stopProcess } from '../lib/processControl.js';
import type { WSO2Process } from '../types.js';

function findCandidates(target: string, processes: WSO2Process[]): WSO2Process[] {
  const asPid = Number(target);
  if (Number.isInteger(asPid) && String(asPid) === target) {
    return processes.filter((p) => p.pid === asPid);
  }
  const needle = target.toLowerCase();
  return processes.filter(
    (p) =>
      p.product.toLowerCase().includes(needle) ||
      p.version.toLowerCase().includes(needle) ||
      p.carbonHome.toLowerCase().includes(needle)
  );
}

function register(program: Command): void {
  program
    .command('stop <target>')
    .description('Stop a single running WSO2 product (PID or product-name match)')
    .option('-y, --yes', 'skip confirmation prompt')
    .option('--force', 'skip graceful shutdown, SIGKILL immediately')
    .option('--dry-run', 'show what would be stopped without doing it')
    .option('--timeout <seconds>', 'graceful shutdown timeout in seconds', '15')
    .action(async (target: string, opts) => {
      const processes = scanWso2Processes();
      if (processes.length === 0) {
        console.log('No WSO2 products running.');
        return;
      }

      const candidates = findCandidates(target, processes);
      if (candidates.length === 0) {
        console.error(`No running WSO2 process matched "${target}".`);
        process.exitCode = 1;
        return;
      }

      let chosen = candidates[0];
      if (candidates.length > 1) {
        const answer = await prompts({
          type: 'select',
          name: 'pid',
          message: `Multiple matches for "${target}" — which one?`,
          choices: candidates.map((p) => ({
            title: `${p.product} ${p.version} (PID ${p.pid}, up ${p.etime})`,
            value: p.pid,
          })),
        });
        if (answer.pid === undefined) {
          console.log('Cancelled.');
          return;
        }
        chosen = candidates.find((p) => p.pid === answer.pid)!;
      }

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
