import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { scanWso2Processes } from '../lib/processScan.js';
import { resolvePackTarget } from '../lib/targetResolver.js';
import { LOG_LEVELS, LOG_PRESETS, readLogConfig, resetLogLevels, setLogLevels, type LogConfig } from '../lib/logLevels.js';
import { printTable } from '../lib/format.js';
import type { WSO2Process } from '../types.js';

/** Expands preset names into their loggers; anything else is taken as a logger name. */
function expandLoggers(names: string[]): { loggers: string[]; presets: string[] } {
  const loggers: string[] = [];
  const presets: string[] = [];
  for (const name of names) {
    const preset = LOG_PRESETS[name.toLowerCase()];
    if (preset) {
      presets.push(name.toLowerCase());
      loggers.push(...preset.loggers);
    } else {
      loggers.push(name);
    }
  }
  return { loggers: [...new Set(loggers)], presets };
}

// Logger names are dotted package/class names; a bare word is almost always a mistyped preset.
function looksLikeLoggerName(name: string): boolean {
  return /^[A-Za-z_$][\w$-]*(\.[A-Za-z_$][\w$-]*)+$/.test(name);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function closestPreset(name: string): string | null {
  const needle = name.toLowerCase();
  const ranked = Object.keys(LOG_PRESETS)
    .map((preset) => ({ preset, distance: preset.startsWith(needle) ? 0 : editDistance(needle, preset) }))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0].distance <= 2 ? ranked[0].preset : null;
}

function presetsFor(product: string): string[] {
  return Object.keys(LOG_PRESETS).filter((name) => LOG_PRESETS[name].products.includes(product));
}

/**
 * What to run next, built from what is actually running: each product's
 * PID, the presets that fit it, what crectl has already switched on, and
 * ready-to-paste commands.
 */
function printGuide(presetHint?: string): void {
  const processes = scanWso2Processes();
  console.log('Usage: crectl log-level <target> [presets or loggers...] [--level DEBUG] [--reset]\n');
  if (presetHint) console.log(`"${presetHint}" is a preset; also say which product to apply it to.\n`);

  if (processes.length === 0) {
    console.log('No WSO2 products are running. You can still prepare a pack before starting it:');
    console.log(`  crectl log-level <pack-directory> ${presetHint ?? 'wire'}`);
    console.log('\nRun `crectl log-level --help` for all presets.');
    return;
  }

  console.log('Running products:');
  for (const p of processes) {
    let active = 'none';
    try {
      const { overrides } = readLogConfig(p.carbonHome);
      if (overrides.length > 0) active = overrides.map((o) => `${o.logger}=${o.level}`).join(', ');
    } catch {
      active = 'unknown (log4j2.properties not found)';
    }
    const presets = presetsFor(p.product);
    console.log(`  PID ${p.pid}  ${p.product} ${p.version}  (${path.basename(p.carbonHome)})`);
    console.log(`    presets: ${presets.length > 0 ? presets.join(', ') : 'none specific; use a logger name'}`);
    console.log(`    active:  ${active}`);
  }

  const example = processes.find((p) => presetHint && LOG_PRESETS[presetHint].products.includes(p.product)) ?? processes[0];
  const examplePreset = presetHint ?? presetsFor(example.product)[0] ?? 'org.example.MyClass';
  const tryLines: [string, string][] = [
    [`crectl log-level ${example.pid} ${examplePreset}`, 'turn it on (DEBUG)'],
    [`crectl log-level ${example.pid} org.example.MyClass --level TRACE`, 'any logger, any level'],
    [`crectl log-level ${example.pid}`, 'show what is switched on'],
    [`crectl log-level ${example.pid} --reset`, "back to the pack's own levels"],
  ];
  const width = Math.max(...tryLines.map(([command]) => command.length));
  console.log('\nTry:');
  for (const [command, purpose] of tryLines) console.log(`  ${command.padEnd(width)}  ${purpose}`);
  console.log('\nRun `crectl log-level --help` for what each preset covers.');
}

function presetHelp(): string {
  const width = Math.max(...Object.keys(LOG_PRESETS).map((n) => n.length));
  const lines = Object.entries(LOG_PRESETS).map(([name, p]) => `  ${name.padEnd(width)}  ${p.description}`);
  return [
    '',
    'Presets:',
    ...lines,
    '',
    'Examples:',
    '  crectl log-level am wire                  wire logs on the running API Manager',
    '  crectl log-level is oauth saml            several presets at once',
    '  crectl log-level 4242 org.foo.Bar --level TRACE',
    '  crectl log-level ./wso2mi-4.4.0 synapse   a pack that is not running (applies on start)',
    '  crectl log-level am                       show active overrides',
    '  crectl log-level am wire --reset          remove one preset again',
    '  crectl log-level am --reset               restore the pack\'s own log levels',
  ].join('\n');
}

function printConfig(config: LogConfig, runningProcess: WSO2Process | null, changed: boolean): void {
  if (config.overrides.length === 0) {
    console.log(changed ? `Removed all crectl overrides; ${config.file} is back to the pack's own levels.` : `No crectl log-level overrides in ${config.file}.`);
    if (changed && runningProcess) console.log('The running server picks this up within a few seconds; no restart needed.');
    if (!changed) {
      const presets = runningProcess ? presetsFor(runningProcess.product) : Object.keys(LOG_PRESETS);
      const target = runningProcess ? String(runningProcess.pid) : '<pack>';
      console.log(`\nPresets${runningProcess ? ` for ${runningProcess.product}` : ''}: ${presets.join(', ')}`);
      console.log(`Turn one on with: crectl log-level ${target} ${presets[0] ?? 'org.example.MyClass'}`);
    }
    return;
  }
  printTable(
    ['LOGGER', 'LEVEL', 'PACK_DEFAULT'],
    config.overrides.map((o) => [o.logger, o.level, o.packLevel ?? '(inherited)'])
  );
  console.log(`\n${config.file}`);
  if (!runningProcess) console.log('The pack is not running; these apply on its next start.');
  else if (changed) console.log('The running server picks this up within a few seconds; no restart needed.');
}

function register(program: Command): void {
  program
    .command('log-level [target] [loggers...]')
    .alias('log-levels')
    .description('Turn on debug logging for a preset or logger, without a restart, and undo it later')
    .option('--level <level>', `level to set: ${LOG_LEVELS.join(', ')}`, 'DEBUG')
    .option('--reset', 'remove crectl overrides (only the given loggers/presets, or all of them)')
    .option('--json', 'output as JSON')
    .addHelpText('after', presetHelp())
    .action(async (target: string | undefined, names: string[], opts) => {
      // No target, or a preset typed where the product should go: explain instead of erroring.
      const targetIsPreset = target !== undefined && LOG_PRESETS[target.toLowerCase()] && !fs.existsSync(target);
      if (target === undefined || (targetIsPreset && names.length === 0)) {
        printGuide(targetIsPreset ? target!.toLowerCase() : undefined);
        return;
      }

      const level = String(opts.level).toUpperCase();
      if (!LOG_LEVELS.includes(level)) {
        console.error(`Unknown level "${opts.level}". Use one of: ${LOG_LEVELS.join(', ')}.`);
        process.exitCode = 1;
        return;
      }

      const { loggers, presets } = expandLoggers(names);
      const invalid = loggers.filter((l) => !looksLikeLoggerName(l));
      if (invalid.length > 0) {
        for (const name of invalid) {
          const suggestion = closestPreset(name);
          console.error(
            `"${name}" is not a preset or a logger name (loggers look like org.apache.synapse).` +
              (suggestion ? ` Did you mean "${suggestion}"?` : '')
          );
        }
        console.error(`Presets: ${Object.keys(LOG_PRESETS).join(', ')}`);
        process.exitCode = 1;
        return;
      }

      const resolved = await resolvePackTarget(target);
      if (!resolved) return;
      const { carbonHome, runningProcess } = resolved;

      let config: LogConfig;
      try {
        if (opts.reset) config = resetLogLevels(carbonHome, loggers);
        else if (loggers.length > 0) config = setLogLevels(carbonHome, loggers, level);
        else config = readLogConfig(carbonHome);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({ carbonHome, running: runningProcess !== null, ...config }, null, 2));
        return;
      }

      const product = runningProcess?.product;
      for (const name of presets) {
        if (product && !LOG_PRESETS[name].products.includes(product)) {
          console.log(`Note: preset "${name}" is meant for ${LOG_PRESETS[name].products.join(', ')}, not ${product}.`);
        }
      }
      printConfig(config, runningProcess, Boolean(opts.reset) || loggers.length > 0);
    });
}

export default { register };
