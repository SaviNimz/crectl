import type { Command } from 'commander';
import { scanWso2Processes } from '../lib/processScan.js';
import { getPortalUrls } from '../lib/apiManagerPortals.js';
import { printTable } from '../lib/format.js';

function register(program: Command): void {
  program
    .command('status')
    .description('Show running WSO2 products')
    .option('--json', 'output as JSON')
    .action((opts) => {
      const processes = scanWso2Processes();

      if (opts.json) {
        const withPortals = processes.map((p) => ({ ...p, portals: getPortalUrls(p) }));
        console.log(JSON.stringify(withPortals, null, 2));
        return;
      }

      if (processes.length === 0) {
        console.log('No WSO2 products running.');
        return;
      }

      printTable(
        ['PID', 'PRODUCT', 'VERSION', 'UPTIME', 'ADMIN', 'PUBLISHER', 'DEVPORTAL', 'CARBON_HOME'],
        processes.map((p) => {
          const portals = getPortalUrls(p);
          return [
            String(p.pid),
            p.product,
            p.version || '-',
            p.etime,
            portals?.admin ?? '-',
            portals?.publisher ?? '-',
            portals?.devportal ?? '-',
            p.carbonHome || '-',
          ];
        })
      );
    });
}

export default { register };
