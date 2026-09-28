import prompts from 'prompts';
import { scanWso2Processes } from './processScan.js';
import type { WSO2Process } from '../types.js';

/** Matches a target against running processes: an exact PID, or a substring of product, version or CARBON_HOME. */
export function findMatchingProcesses(target: string, processes: WSO2Process[]): WSO2Process[] {
  const targetAsPid = Number(target);
  if (Number.isInteger(targetAsPid) && String(targetAsPid) === target) {
    return processes.filter((p) => p.pid === targetAsPid);
  }
  const needle = target.toLowerCase();
  return processes.filter(
    (p) =>
      p.product.toLowerCase().includes(needle) ||
      p.version.toLowerCase().includes(needle) ||
      p.carbonHome.toLowerCase().includes(needle)
  );
}

/**
 * Resolves a command's `<target>` argument to one running WSO2 process,
 * asking the user to pick if several match. Prints why and returns null
 * when nothing suitable is found or the user cancels.
 */
export async function selectRunningProcess(target: string): Promise<WSO2Process | null> {
  const processes = scanWso2Processes();
  if (processes.length === 0) {
    console.log('No WSO2 products running.');
    return null;
  }

  const matches = findMatchingProcesses(target, processes);
  if (matches.length === 0) {
    console.error(`No running WSO2 process matched "${target}".`);
    process.exitCode = 1;
    return null;
  }
  if (matches.length === 1) return matches[0];

  const answer = await prompts({
    type: 'select',
    name: 'pid',
    message: `Multiple matches for "${target}" — which one?`,
    choices: matches.map((p) => ({
      title: `${p.product} ${p.version} (PID ${p.pid}, up ${p.etime})`,
      value: p.pid,
    })),
  });
  if (answer.pid === undefined) {
    console.log('Cancelled.');
    return null;
  }
  return matches.find((p) => p.pid === answer.pid) ?? null;
}
