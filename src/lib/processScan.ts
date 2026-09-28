import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveProduct } from './productMap.js';
import { getListeningPorts } from './portScan.js';
import type { WSO2Process } from '../types.js';

// Every WSO2 product's startup script (wso2server.sh, micro-integrator.sh, ...)
// launches the JVM with -Dcarbon.home, so that flag is the signature. Matching
// the script names too would also pick up the `sh wso2server.sh` launcher shell
// that sits in front of each JVM, and a bare "wso2" substring would match
// unrelated paths (e.g. this tool's own install directory).
const CARBON_HOME_FLAG = /-Dcarbon\.home=(\S+)/;

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
    const carbonHomeMatch = command.match(CARBON_HOME_FLAG);
    if (!carbonHomeMatch) continue;

    const carbonHome = carbonHomeMatch[1];
    const { product, version } = resolveProduct(path.basename(carbonHome));

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
