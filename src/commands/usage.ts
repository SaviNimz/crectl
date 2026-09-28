import type { Command } from 'commander';
import { scanWso2Processes } from '../lib/processScan.js';
import { isDockerAvailable, scanWso2Containers, getContainerStats } from '../lib/containerScan.js';
import { printTable } from '../lib/format.js';

interface UsageRow {
  source: string;
  name: string;
  cpu: number;
  memMB: number;
  memDisplay: string;
}

function register(program: Command): void {
  program
    .command('usage')
    .description('Show CPU/memory usage per running WSO2 product (native + container)')
    .option('--sort <field>', 'sort by "cpu" or "mem"', 'cpu')
    .option('--json', 'output as JSON')
    .action((opts) => {
      const rows: UsageRow[] = [];

      for (const p of scanWso2Processes()) {
        rows.push({
          source: `native (PID ${p.pid})`,
          name: `${p.product} ${p.version}`.trim(),
          cpu: p.cpu,
          memMB: p.rss / 1024,
          memDisplay: `${(p.rss / 1024).toFixed(0)} MB`,
        });
      }

      if (isDockerAvailable()) {
        const containers = scanWso2Containers();
        const stats = getContainerStats(containers.map((c) => c.id));
        for (const c of containers) {
          const s = stats.get(c.id);
          rows.push({
            source: `container (${c.id.slice(0, 12)})`,
            name: c.name,
            cpu: s?.cpu ?? 0,
            memMB: s?.memMB ?? 0,
            memDisplay: s?.memDisplay ?? '-',
          });
        }
      }

      rows.sort((a, b) => (opts.sort === 'mem' ? b.memMB - a.memMB : b.cpu - a.cpu));

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log('No WSO2 products running.');
        return;
      }

      printTable(
        ['SOURCE', 'PRODUCT', 'CPU %', 'MEM'],
        rows.map((r) => [r.source, r.name, r.cpu.toFixed(1), r.memDisplay])
      );
    });
}

export default { register };
