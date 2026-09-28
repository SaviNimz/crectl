import { setTimeout as sleep } from 'node:timers/promises';

export interface StopOptions {
  force?: boolean;
  timeoutMs?: number;
  dryRun?: boolean;
}

export type StopResult = 'killed' | 'already-stopped' | 'dry-run';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops a process gracefully (SIGTERM, wait, then SIGKILL if it's still
 * alive after the timeout) unless `force` asks for an immediate SIGKILL.
 */
export async function stopProcess(pid: number, opts: StopOptions = {}): Promise<StopResult> {
  if (!isAlive(pid)) return 'already-stopped';
  if (opts.dryRun) return 'dry-run';

  if (opts.force) {
    process.kill(pid, 'SIGKILL');
    return 'killed';
  }

  process.kill(pid, 'SIGTERM');
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return 'killed';
    await sleep(500);
  }
  if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  return 'killed';
}
