import { execFileSync } from 'node:child_process';
import net from 'node:net';

export interface PortListener {
  port: number;
  pid: number;
  processName: string;
}

/**
 * Every TCP port in LISTEN state that this user can see, via one batched
 * `lsof` call. Processes owned by other users (e.g. root) are not visible
 * without sudo — use `isPortInUse` to catch those.
 */
export function listListeningSockets(): PortListener[] {
  let output: string;
  try {
    output = execFileSync('lsof', ['-Pan', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8' });
  } catch {
    // lsof missing, no permission, or nothing listening — degrade to no port info.
    return [];
  }

  const listeners: PortListener[] = [];
  let currentPid = 0;
  let currentProcessName = '';
  for (const line of output.split('\n')) {
    if (!line) continue;
    const fieldType = line[0];
    const fieldValue = line.slice(1);
    if (fieldType === 'p') {
      currentPid = Number(fieldValue);
    } else if (fieldType === 'c') {
      currentProcessName = fieldValue;
    } else if (fieldType === 'n') {
      const portMatch = fieldValue.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = Number(portMatch[1]);
      const alreadyRecorded = listeners.some((l) => l.pid === currentPid && l.port === port);
      if (!alreadyRecorded) listeners.push({ port, pid: currentPid, processName: currentProcessName });
    }
  }
  return listeners;
}

/** The TCP ports each given PID is listening on. */
export function getListeningPorts(pids: number[]): Map<number, number[]> {
  const portsByPid = new Map<number, number[]>();
  const wantedPids = new Set(pids);
  for (const { pid, port } of listListeningSockets()) {
    if (!wantedPids.has(pid)) continue;
    portsByPid.set(pid, [...(portsByPid.get(pid) ?? []), port]);
  }
  return portsByPid;
}

/**
 * Checks a port by trying to bind to it. This catches listeners that lsof
 * can't see (other users' processes).
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port);
  });
}

/**
 * Names the owner of a listening port that lsof can't see. macOS `netstat -anv`
 * shows a "process:pid" column for every socket without needing sudo.
 * Returns null on other platforms or if the owner can't be found.
 */
export function findHiddenListener(port: number): string | null {
  if (process.platform !== 'darwin') return null;

  let output: string;
  try {
    output = execFileSync('netstat', ['-anv', '-p', 'tcp'], { encoding: 'utf8' });
  } catch {
    return null;
  }

  for (const line of output.split('\n')) {
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[3] ?? '';
    const isListenerOnPort = columns.includes('LISTEN') && localAddress.endsWith(`.${port}`);
    if (!isListenerOnPort) continue;

    const ownerColumn = columns.find((column) => /^[^:\s]+:\d+$/.test(column));
    if (ownerColumn) {
      const [processName, pid] = ownerColumn.split(':');
      return `PID ${pid} (${processName})`;
    }
  }
  return null;
}
