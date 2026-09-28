import type { Command } from 'commander';
import { scanWso2Processes } from '../lib/processScan.js';
import { listListeningSockets, isPortInUse, findHiddenListener, type PortListener } from '../lib/portScan.js';
import { getPortProfile, PRODUCT_ALIASES, type PortProfile } from '../lib/productPorts.js';
import { resolvePortOffset } from '../lib/deploymentConfig.js';
import { printTable } from '../lib/format.js';

const MAX_OFFSET_TO_SUGGEST = 100;

interface PortCheck {
  port: number;
  purpose: string;
  free: boolean;
  heldBy: string | null;
}

/** Checks every port a product would bind at the given offset, and reports who holds any that are taken. */
async function checkPortsAtOffset(profile: PortProfile, offset: number, listeners: PortListener[]): Promise<PortCheck[]> {
  const checks: PortCheck[] = [];
  for (const { basePort, purpose } of profile.ports) {
    const port = basePort + offset;
    const holder = listeners.find((l) => l.port === port);
    if (holder) {
      checks.push({ port, purpose, free: false, heldBy: `PID ${holder.pid} (${holder.processName})` });
    } else if (await isPortInUse(port)) {
      const hiddenHolder = findHiddenListener(port) ?? 'unknown (another user’s process — try sudo lsof)';
      checks.push({ port, purpose, free: false, heldBy: hiddenHolder });
    } else {
      checks.push({ port, purpose, free: true, heldBy: null });
    }
  }
  return checks;
}

function resolveProductOption(productOption: string): string | null {
  return PRODUCT_ALIASES[productOption.toLowerCase()] ?? null;
}

function showRunningInstances(asJson: boolean): void {
  const processes = scanWso2Processes();
  const report = processes.map((p) => {
    const profile = getPortProfile(p.product, p.version);
    const offset = resolvePortOffset(p.carbonHome, p.command, profile.defaultOffset);
    const expectedPorts = profile.ports.map(({ basePort, purpose }) => {
      const port = basePort + offset.value;
      return { port, purpose, listening: p.ports.includes(port) };
    });
    const knownPorts = new Set(expectedPorts.map((e) => e.port));
    const otherPorts = p.ports.filter((port) => !knownPorts.has(port));
    return { process: p, offset, expectedPorts, otherPorts };
  });

  if (asJson) {
    console.log(
      JSON.stringify(
        report.map(({ process: p, offset, expectedPorts, otherPorts }) => ({
          pid: p.pid,
          product: p.product,
          version: p.version,
          carbonHome: p.carbonHome,
          offset,
          ports: expectedPorts,
          otherPorts,
        })),
        null,
        2
      )
    );
    return;
  }

  if (report.length === 0) {
    console.log('No WSO2 products running.');
    return;
  }

  for (const { process: p, offset, expectedPorts, otherPorts } of report) {
    console.log(`\n${p.product} ${p.version} (PID ${p.pid}) — offset ${offset.value} from ${offset.source}`);
    const rows = expectedPorts.map(({ port, purpose, listening }) => [
      String(port),
      listening ? 'listening' : 'NOT LISTENING',
      purpose,
    ]);
    for (const port of otherPorts) {
      rows.push([String(port), 'listening', '(not a standard WSO2 port — debug agent, custom listener, ...)']);
    }
    printTable(['PORT', 'STATUS', 'PURPOSE'], rows);
  }
}

async function showOffsetCheck(product: string, offset: number, asJson: boolean): Promise<void> {
  const checks = await checkPortsAtOffset(getPortProfile(product), offset, listListeningSockets());
  const conflicts = checks.filter((c) => !c.free);

  if (asJson) {
    console.log(JSON.stringify({ product, offset, free: conflicts.length === 0, ports: checks }, null, 2));
  } else {
    console.log(`${product} ports at offset ${offset}:`);
    printTable(
      ['PORT', 'STATUS', 'HELD BY', 'PURPOSE'],
      checks.map((c) => [String(c.port), c.free ? 'free' : 'IN USE', c.heldBy ?? '-', c.purpose])
    );
    console.log(
      conflicts.length === 0
        ? `\nAll ${checks.length} ports are free — safe to start with offset ${offset}.`
        : `\n${conflicts.length} port(s) in use. Run "crectl ports --suggest --product <name>" to find a free offset.`
    );
  }
  if (conflicts.length > 0) process.exitCode = 1;
}

async function suggestFreeOffset(product: string, asJson: boolean): Promise<void> {
  const profile = getPortProfile(product);
  const listeners = listListeningSockets();

  for (let offset = profile.defaultOffset; offset <= MAX_OFFSET_TO_SUGGEST; offset++) {
    const checks = await checkPortsAtOffset(profile, offset, listeners);
    if (checks.every((c) => c.free)) {
      if (asJson) {
        console.log(JSON.stringify({ product, offset }, null, 2));
        return;
      }
      console.log(`Lowest free offset for ${product}: ${offset}\n`);
      console.log('Set it in deployment.toml:');
      console.log(`  [server]\n  offset = ${offset}\n`);
      console.log('or pass it at startup:');
      console.log(`  sh bin/<startup-script>.sh -DportOffset=${offset}`);
      return;
    }
  }
  console.error(`No free offset found between ${profile.defaultOffset} and ${MAX_OFFSET_TO_SUGGEST}.`);
  process.exitCode = 1;
}

function register(program: Command): void {
  program
    .command('ports')
    .description('Show the ports each running WSO2 product uses, or check whether an offset is free')
    .option('--offset <n>', 'check whether every port for this offset is free')
    .option('--suggest', 'find the lowest port offset whose ports are all free')
    .option('--product <name>', `product for --offset/--suggest: ${Object.keys(PRODUCT_ALIASES).join(', ')}`, 'am')
    .option('--json', 'output as JSON')
    .action(async (opts) => {
      const isOffsetCheck = opts.offset !== undefined || opts.suggest;
      if (!isOffsetCheck) {
        showRunningInstances(opts.json);
        return;
      }

      const product = resolveProductOption(opts.product);
      if (!product) {
        console.error(`Unknown product "${opts.product}". Use one of: ${Object.keys(PRODUCT_ALIASES).join(', ')}.`);
        process.exitCode = 1;
        return;
      }

      if (opts.suggest) {
        await suggestFreeOffset(product, opts.json);
        return;
      }

      const offset = Number(opts.offset);
      if (!Number.isInteger(offset) || offset < 0) {
        console.error(`--offset must be a non-negative integer, got "${opts.offset}".`);
        process.exitCode = 1;
        return;
      }
      await showOffsetCheck(product, offset, opts.json);
    });
}

export default { register };
