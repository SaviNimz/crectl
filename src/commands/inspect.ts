import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { scanWso2Processes } from '../lib/processScan.js';
import { selectRunningProcess } from '../lib/targetResolver.js';
import { isWso2PackDirectory } from '../lib/packLayout.js';
import { inspectPack, type PackReport } from '../lib/packInspector.js';
import { printSection, printTable } from '../lib/format.js';
import type { WSO2Process } from '../types.js';

// Beyond this many jars, show a count instead of the full list (use --json for everything).
const MAX_JARS_TO_LIST = 15;

interface InspectTarget {
  carbonHome: string;
  runningProcess: WSO2Process | null;
}

/** A target is either a pack directory (running or not) or a PID / name match against running products. */
async function resolveInspectTarget(target: string): Promise<InspectTarget | null> {
  const targetPath = path.resolve(target);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    if (!isWso2PackDirectory(targetPath)) {
      console.error(`${targetPath} doesn't look like a WSO2 pack (no bin/ and deployment.toml).`);
      process.exitCode = 1;
      return null;
    }
    const runningProcess = scanWso2Processes().find((p) => path.resolve(p.carbonHome) === targetPath) ?? null;
    return { carbonHome: targetPath, runningProcess };
  }

  const runningProcess = await selectRunningProcess(target);
  return runningProcess ? { carbonHome: runningProcess.carbonHome, runningProcess } : null;
}

function describeRuntime(runtime: PackReport['runtime']): [string, string][] {
  const jdk = runtime.javaBinary ? `${runtime.javaVersion ?? 'unknown version'} (${runtime.javaBinary})` : 'unknown';
  if (!runtime.running) {
    return [
      ['Status', 'not running'],
      ['JDK', `${jdk} — from JAVA_HOME`],
    ];
  }
  return [
    ['Status', `running — PID ${runtime.pid}, up ${runtime.uptime}`],
    ['JDK', jdk],
    ['Heap', `-Xms${runtime.heapInitial ?? '?'} -Xmx${runtime.heapMax ?? '?'}`],
  ];
}

function describeJarList(jars: string[]): string {
  if (jars.length === 0) return 'none';
  if (jars.length > MAX_JARS_TO_LIST) return `${jars.length} jars (use --json to list them)`;
  return jars.join('\n');
}

function describeDropins(extensions: PackReport['extensions']): string {
  const hiddenCount = extensions.generatedBundles.length;
  if (hiddenCount === 0) return describeJarList(extensions.dropins);

  const hiddenNote = `(+ ${hiddenCount} OSGi bundle${hiddenCount === 1 ? '' : 's'} Carbon generated from lib/ — hidden)`;
  return extensions.dropins.length === 0 ? `none ${hiddenNote}` : `${describeJarList(extensions.dropins)}\n${hiddenNote}`;
}

function printReport(report: PackReport): void {
  printSection('Product', [
    ['Product', `${report.product} ${report.version}`.trim()],
    ['Location', report.carbonHome],
    ['Update level', report.updateLevel ?? 'none recorded (GA pack, or updated with an older tool)'],
  ]);

  printSection('Runtime', describeRuntime(report.runtime));

  printSection('Ports', [
    ['Offset', `${report.portOffset.value} (${report.portOffset.source})`],
    ['Primary port', `${report.primaryPort.port} — ${report.primaryPort.purpose}`],
  ]);

  const configRows: [string, string][] = [['File', report.deploymentToml]];
  if (report.deploymentTomlError) configRows.push(['Warning', report.deploymentTomlError]);
  if (report.keyManager) configRows.push(['Key manager', report.keyManager]);
  printSection('Configuration', configRows);

  if (report.datasources.length > 0) {
    console.log('\n  Datasources:');
    printTable(
      ['NAME', 'TYPE', 'USERNAME', 'URL'],
      report.datasources.map((d) => [d.name, d.type, d.username, d.url]),
      '  '
    );
  }
  if (report.gatewayEnvironments.length > 0) {
    console.log('\n  Gateway environments:');
    printTable(
      ['NAME', 'TYPE', 'SERVICE URL'],
      report.gatewayEnvironments.map((g) => [g.name, g.type, g.serviceUrl]),
      '  '
    );
  }

  console.log('\nKeystores');
  printTable(
    ['ROLE', 'FILE', 'ENTRIES', 'CERT EXPIRES', 'NOTE'],
    report.keystores.map((k) => [
      k.role,
      path.basename(k.file),
      k.entryCount === undefined ? '-' : String(k.entryCount),
      k.certificateExpiry ? `${k.certificateExpiry} (${k.daysUntilExpiry} days)` : '-',
      k.exists ? (k.note ?? '') : 'FILE NOT FOUND',
    ]),
    '  '
  );

  printSection('Extensions', [
    ['lib', describeJarList(report.extensions.lib)],
    ['dropins', describeDropins(report.extensions)],
    ['patches', report.extensions.patches.length > 0 ? report.extensions.patches.join(', ') : 'none'],
  ]);
  console.log('');
}

function register(program: Command): void {
  program
    .command('inspect <target>')
    .description('Summarise a pack: version, update level, JDK, ports, datasources, keystores, custom jars')
    .option('--json', 'output as JSON')
    .addHelpText('after', '\n<target> is a pack directory (running or not), a PID, or a name match like "4.3.0".')
    .action(async (target: string, opts) => {
      const resolved = await resolveInspectTarget(target);
      if (!resolved) return;

      const report = inspectPack(resolved.carbonHome, resolved.runningProcess);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      printReport(report);
    });
}

export default { register };
