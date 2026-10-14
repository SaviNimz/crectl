import type { Command } from 'commander';
import { scanWso2Processes } from '../lib/processScan.js';
import { getPortalUrls } from '../lib/apiManagerPortals.js';
import { getIdentityServerUrls, getMicroIntegratorUrls } from '../lib/productUrls.js';
import { printTable } from '../lib/format.js';
import type { WSO2Process } from '../types.js';

interface StatusSection {
  title: string;
  products: string[];
  urlHeaders: string[];
  urlColumns: (p: WSO2Process) => (string | null)[];
}

const SECTIONS: StatusSection[] = [
  {
    title: 'API Manager',
    products: ['API Manager', 'API Control Plane', 'Universal Gateway', 'Traffic Manager', 'API Manager Analytics'],
    urlHeaders: ['ADMIN', 'PUBLISHER', 'DEVPORTAL'],
    urlColumns: (p) => {
      const portals = getPortalUrls(p);
      return [portals?.admin ?? null, portals?.publisher ?? null, portals?.devportal ?? null];
    },
  },
  {
    title: 'Identity Server',
    products: ['Identity Server', 'Identity Server KM'],
    urlHeaders: ['CONSOLE', 'MYACCOUNT', 'CARBON'],
    urlColumns: (p) => {
      const urls = getIdentityServerUrls(p);
      return [urls?.console ?? null, urls?.myaccount ?? null, urls?.carbon ?? null];
    },
  },
  {
    title: 'Micro Integrator',
    products: ['Micro Integrator'],
    urlHeaders: ['MANAGEMENT_API', 'HTTP', 'HTTPS'],
    urlColumns: (p) => {
      const urls = getMicroIntegratorUrls(p);
      return [urls?.management ?? null, urls?.http ?? null, urls?.https ?? null];
    },
  },
];

// Anything without a dedicated section (EI, SI, ...) is still listed, just without URLs.
const OTHER_SECTION: StatusSection = { title: 'Other', products: [], urlHeaders: [], urlColumns: () => [] };

function sectionFor(p: WSO2Process): StatusSection {
  return SECTIONS.find((s) => s.products.includes(p.product)) ?? OTHER_SECTION;
}

function register(program: Command): void {
  program
    .command('status')
    .description('Show running WSO2 products, grouped by product with their URLs')
    .option('--json', 'output as JSON')
    .action((opts) => {
      const processes = scanWso2Processes();

      if (opts.json) {
        const withUrls = processes.map((p) => ({
          ...p,
          portals: getPortalUrls(p),
          urls: getPortalUrls(p) ?? getIdentityServerUrls(p) ?? getMicroIntegratorUrls(p),
        }));
        console.log(JSON.stringify(withUrls, null, 2));
        return;
      }

      if (processes.length === 0) {
        console.log('No WSO2 products running.');
        return;
      }

      // Sections with no running instance are skipped entirely.
      let printedSections = 0;
      for (const section of [...SECTIONS, OTHER_SECTION]) {
        const members = processes.filter((p) => sectionFor(p) === section);
        if (members.length === 0) continue;

        console.log(`${printedSections > 0 ? '\n' : ''}${section.title}`);
        printTable(
          ['PID', 'PRODUCT', 'VERSION', 'UPTIME', ...section.urlHeaders, 'CARBON_HOME'],
          members.map((p) => [
            String(p.pid),
            p.product,
            p.version || '-',
            p.etime,
            ...section.urlColumns(p).map((url) => url ?? '-'),
            p.carbonHome,
          ]),
          '  '
        );
        printedSections++;
      }
    });
}

export default { register };
