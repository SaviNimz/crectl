import type { Command } from 'commander';
import { isDockerAvailable, scanWso2Containers } from '../lib/containerScan.js';
import { printTable } from '../lib/format.js';

function register(program: Command): void {
  program
    .command('containers')
    .description('Show Docker containers running WSO2 products')
    .option('--all', 'include stopped containers')
    .option('--json', 'output as JSON')
    .action((opts) => {
      if (!isDockerAvailable()) {
        console.log('Docker is not available or not running — skipping container check.');
        return;
      }

      const containers = scanWso2Containers(opts.all);

      if (opts.json) {
        console.log(JSON.stringify(containers, null, 2));
        return;
      }

      if (containers.length === 0) {
        console.log('No WSO2 containers found.');
        return;
      }

      printTable(
        ['CONTAINER ID', 'NAME', 'IMAGE', 'STATUS', 'PORTS'],
        containers.map((c) => [c.id.slice(0, 12), c.name, c.image, c.status, c.ports || '-'])
      );
    });
}

export default { register };
