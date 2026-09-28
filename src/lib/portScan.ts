import { execFileSync } from 'node:child_process';

/**
 * Returns the TCP ports each given PID is listening on, via a single
 * batched `lsof` call rather than one call per process.
 */
export function getListeningPorts(pids: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>();
  if (pids.length === 0) return result;
  const pidSet = new Set(pids);

  let output: string;
  try {
    output = execFileSync('lsof', ['-Pan', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8' });
  } catch {
    // lsof missing, no permission, or nothing listening — degrade to no port info.
    return result;
  }

  let currentPid: number | null = null;
  for (const line of output.split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      const pid = Number(value);
      currentPid = pidSet.has(pid) ? pid : null;
    } else if (tag === 'n' && currentPid !== null) {
      const match = value.match(/:(\d+)$/);
      if (!match) continue;
      const port = Number(match[1]);
      const ports = result.get(currentPid) ?? [];
      if (!ports.includes(port)) ports.push(port);
      result.set(currentPid, ports);
    }
  }
  return result;
}
