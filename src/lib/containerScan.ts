import { execFileSync } from 'node:child_process';
import type { WSO2Container } from '../types.js';

export function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Lists Docker containers whose image or name mentions WSO2. */
export function scanWso2Containers(includeAll = false): WSO2Container[] {
  const args = ['ps'];
  if (includeAll) args.push('-a');
  args.push('--format', '{{json .}}');

  let output: string;
  try {
    output = execFileSync('docker', args, { encoding: 'utf8' });
  } catch {
    return [];
  }

  const containers: WSO2Container[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, string>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const image = obj.Image ?? '';
    const name = obj.Names ?? '';
    if (!/wso2/i.test(image) && !/wso2/i.test(name)) continue;
    containers.push({
      id: obj.ID ?? '',
      name,
      image,
      status: obj.Status ?? '',
      ports: obj.Ports ?? '',
    });
  }
  return containers;
}

export interface ContainerStats {
  cpu: number;
  memMB: number;
  memDisplay: string;
}

/** Runs `docker stats` once and returns usage keyed by container ID, for any of the given IDs. */
export function getContainerStats(containerIds: string[]): Map<string, ContainerStats> {
  const stats = new Map<string, ContainerStats>();
  if (containerIds.length === 0) return stats;

  let output: string;
  try {
    output = execFileSync('docker', ['stats', '--no-stream', '--format', '{{json .}}'], {
      encoding: 'utf8',
    });
  } catch {
    return stats;
  }

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, string>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const id = obj.ID ?? obj.Container ?? '';
    const match = containerIds.find((c) => c.startsWith(id) || id.startsWith(c));
    if (!match) continue;

    const cpu = parseFloat(String(obj.CPUPerc ?? '0').replace('%', '')) || 0;
    const memPart = (obj.MemUsage ?? '').split('/')[0]?.trim() ?? '';
    stats.set(match, { cpu, memMB: parseMemToMB(memPart), memDisplay: memPart || '-' });
  }
  return stats;
}

function parseMemToMB(value: string): number {
  const match = value.match(/([\d.]+)\s*(KiB|MiB|GiB|B)?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'MiB').toLowerCase();
  if (unit === 'gib') return num * 1024;
  if (unit === 'kib') return num / 1024;
  if (unit === 'b') return num / (1024 * 1024);
  return num;
}
