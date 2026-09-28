import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveProduct } from './productMap.js';
import { getListeningPorts } from './portScan.js';
import type { WSO2Process } from '../types.js';

// Only these are treated as WSO2 signatures — a bare "wso2" substring
// anywhere in a command (e.g. this very tool's own install path) is not
// enough, to avoid false positives.
const WSO2_SIGNATURES = [
  /-Dcarbon\.home=/,
  /wso2server\.sh/,
  /micro-integrator\.sh/,
  /streaming-integrator\.sh/,
  /wso2carbon\.sh/,
];

function isWso2Process(command: string): boolean {
  return WSO2_SIGNATURES.some((re) => re.test(command));
}

function extractCarbonHome(command: string): string {
  const match = command.match(/-Dcarbon\.home=(\S+)/);
  return match?.[1] ?? '';
}

/** Scans running processes for WSO2 Carbon-based product instances. */
export function scanWso2Processes(): WSO2Process[] {
  let output: string;
  try {
    output = execFileSync('ps', ['-axwwo', 'pid,etime,%cpu,%mem,rss,command'], {
      encoding: 'utf8',
    });
  } catch {
    return [];
  }

  const results: WSO2Process[] = [];
  for (const line of output.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const [, pidStr, etime, cpuStr, memStr, rssStr, command] = match;
    if (!isWso2Process(command)) continue;

    const carbonHome = extractCarbonHome(command);
    const { product, version } = carbonHome
      ? resolveProduct(path.basename(carbonHome))
      : { product: 'WSO2 (unrecognized product)', version: '' };

    results.push({
      pid: Number(pidStr),
      etime,
      cpu: Number(cpuStr),
      mem: Number(memStr),
      rss: Number(rssStr),
      product,
      version,
      carbonHome,
      command,
      ports: [],
    });
  }

  const portsByPid = getListeningPorts(results.map((p) => p.pid));
  for (const p of results) {
    p.ports = (portsByPid.get(p.pid) ?? []).sort((a, b) => a - b);
  }

  return results;
}
