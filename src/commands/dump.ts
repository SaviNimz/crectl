import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { selectRunningProcess } from '../lib/targetResolver.js';
import { findJdkTool, getJavaBinary } from '../lib/jdkTools.js';
import { formatBytes, formatTimestamp, printTable } from '../lib/format.js';
import type { WSO2Process } from '../types.js';

// How long to keep waiting for the JFR file to be written after the recording should have ended.
const JFR_WRITE_GRACE_PERIOD_MS = 30_000;
const PROCESS_INFO_FILE = 'process-info.txt';

// jcmd sometimes exits 0 even when it fails, so we also look for these in the first few lines of its output.
const JCMD_FAILURE_PATTERN = /Exception|Could not|not supported/i;

/** Runs `jcmd <pid> <args>` and returns its output, throwing a short explanation on failure. */
function runJcmd(jcmdPath: string, pid: number, args: string[]): string {
  const result = spawnSync(jcmdPath, [String(pid), ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`could not run ${jcmdPath}: ${result.error.message}`);
  }

  const outputLines = `${result.stdout}${result.stderr}`.split('\n').map((line) => line.trim()).filter(Boolean);
  const failureLine = outputLines.slice(0, 3).find((line) => JCMD_FAILURE_PATTERN.test(line));
  if (result.status !== 0 || failureLine) {
    const reason = failureLine ?? outputLines.at(-1) ?? `jcmd exited with status ${result.status}`;
    throw new Error(`${reason}\n  (jcmd: ${jcmdPath} — it must run as the same user as the server, from a compatible JDK)`);
  }
  return result.stdout;
}

/** A recording shows as "(running)" in JFR.check until it ends, then disappears once its file is written. */
function isJfrRecordingActive(jcmdPath: string, pid: number, recordingName: string): boolean {
  const result = spawnSync(jcmdPath, [String(pid), 'JFR.check', `name=${recordingName}`], { encoding: 'utf8' });
  return /\((running|delayed|stopping)\)/.test(result.stdout);
}

function hasContent(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).size > 0;
}

/**
 * Per-thread CPU is what turns a thread dump into an answer ("which thread
 * is burning CPU?"). `top -H` gives native thread IDs that match the `nid`
 * in the dump. macOS has no equivalent, so it's Linux only.
 */
function capturePerThreadCpu(pid: number): string | null {
  if (process.platform !== 'linux') return null;
  const result = spawnSync('top', ['-H', '-b', '-n', '1', '-p', String(pid)], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

function writeProcessInfo(outputDir: string, target: WSO2Process, jcmdPath: string): void {
  const lines = [
    `Product:      ${target.product} ${target.version}`,
    `PID:          ${target.pid}`,
    `Uptime:       ${target.etime}`,
    `CARBON_HOME:  ${target.carbonHome}`,
    `jcmd:         ${jcmdPath}`,
    `Captured at:  ${new Date().toISOString()}`,
    '',
    'JVM command line:',
    target.command,
    '',
  ];
  fs.writeFileSync(path.join(outputDir, PROCESS_INFO_FILE), lines.join('\n'));
}

function parseNonNegativeInteger(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer, got "${value}".`);
  }
  return parsed;
}

interface DumpPlan {
  threadDumpCount: number;
  intervalSeconds: number;
  jfrSeconds: number;
  wantsHeapDump: boolean;
  outputParentDir: string;
}

function buildDumpPlan(opts: Record<string, string | boolean | undefined>): DumpPlan {
  const plan: DumpPlan = {
    threadDumpCount: parseNonNegativeInteger(String(opts.threads), '--threads'),
    intervalSeconds: parseNonNegativeInteger(String(opts.interval), '--interval'),
    jfrSeconds: opts.jfr === undefined ? 0 : parseNonNegativeInteger(String(opts.jfr), '--jfr'),
    wantsHeapDump: Boolean(opts.heap),
    outputParentDir: String(opts.out),
  };
  if (plan.threadDumpCount === 0 && !plan.wantsHeapDump && plan.jfrSeconds === 0) {
    throw new Error('Nothing to capture: --threads is 0 and neither --heap nor --jfr was given.');
  }
  return plan;
}

/** Creates the dump folder, captures into it, and cleans it up again if nothing was captured. */
async function captureDumps(target: WSO2Process, plan: DumpPlan): Promise<void> {
  const packFolderName = path.basename(target.carbonHome);
  const outputDir = path.resolve(plan.outputParentDir, `${packFolderName}-pid${target.pid}-${formatTimestamp()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    await captureInto(outputDir, target, plan);
  } catch (err) {
    const capturedSomething = fs.readdirSync(outputDir).some((file) => file !== PROCESS_INFO_FILE);
    if (capturedSomething) {
      console.error(`Partial results kept in ${outputDir}`);
    } else {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    throw err;
  }

  console.log('');
  printTable(
    ['FILE', 'SIZE'],
    fs.readdirSync(outputDir).sort().map((file) => [file, formatBytes(fs.statSync(path.join(outputDir, file)).size)])
  );
}

async function captureInto(outputDir: string, target: WSO2Process, plan: DumpPlan): Promise<void> {
  const { threadDumpCount, intervalSeconds, jfrSeconds, wantsHeapDump } = plan;
  const jcmdPath = findJdkTool('jcmd', getJavaBinary(target.command));
  writeProcessInfo(outputDir, target, jcmdPath);
  console.log(`Capturing from ${target.product} ${target.version} (PID ${target.pid}) into:\n  ${outputDir}\n`);

  // Start the flight recording first so thread dumps and the heap dump happen while it records.
  const jfrFile = path.join(outputDir, 'recording.jfr');
  const jfrRecordingName = `wso2ctl-${target.pid}`;
  const jfrEndsAt = Date.now() + jfrSeconds * 1000;
  if (jfrSeconds > 0) {
    runJcmd(jcmdPath, target.pid, ['JFR.start', `name=${jfrRecordingName}`, `duration=${jfrSeconds}s`, `filename=${jfrFile}`]);
    console.log(`JFR recording started (${jfrSeconds}s).`);
  }

  for (let dumpNumber = 1; dumpNumber <= threadDumpCount; dumpNumber++) {
    const threadDump = runJcmd(jcmdPath, target.pid, ['Thread.print', '-l']);
    fs.writeFileSync(path.join(outputDir, `thread-dump-${dumpNumber}.txt`), threadDump);

    const perThreadCpu = capturePerThreadCpu(target.pid);
    if (perThreadCpu) fs.writeFileSync(path.join(outputDir, `thread-cpu-${dumpNumber}.txt`), perThreadCpu);

    console.log(`Thread dump ${dumpNumber}/${threadDumpCount} captured.`);
    const isLastDump = dumpNumber === threadDumpCount;
    if (!isLastDump && intervalSeconds > 0) await sleep(intervalSeconds * 1000);
  }

  if (wantsHeapDump) {
    console.log('Taking heap dump — the JVM pauses while this runs, and the file is roughly the size of the used heap...');
    runJcmd(jcmdPath, target.pid, ['GC.heap_dump', path.join(outputDir, 'heap-dump.hprof')]);
    console.log('Heap dump captured.');
  }

  if (jfrSeconds > 0) {
    const remainingMs = jfrEndsAt - Date.now();
    if (remainingMs > 0) {
      console.log(`Waiting ${Math.ceil(remainingMs / 1000)}s for the JFR recording to finish...`);
      await sleep(remainingMs);
    }
    // The JVM creates the file empty at start and only writes it once the recording ends.
    const giveUpAt = Date.now() + JFR_WRITE_GRACE_PERIOD_MS;
    const isStillWriting = () => isJfrRecordingActive(jcmdPath, target.pid, jfrRecordingName) || !hasContent(jfrFile);
    while (isStillWriting() && Date.now() < giveUpAt) await sleep(500);
    console.log(hasContent(jfrFile) ? 'JFR recording captured.' : 'JFR file is still empty — check the server log.');
  }
}

function register(program: Command): void {
  program
    .command('dump <target>')
    .description('Capture thread dumps, a heap dump and/or a JFR recording from a running WSO2 product')
    .option('--threads <count>', 'number of thread dumps to take (0 to skip)', '3')
    .option('--interval <seconds>', 'seconds between thread dumps', '5')
    .option('--heap', 'also take a heap dump (pauses the JVM while it runs)')
    .option('--jfr <seconds>', 'also record a Java Flight Recording for this many seconds')
    .option('--out <dir>', 'parent directory for the dump folder', './wso2ctl-dumps')
    .action(async (target: string, opts) => {
      try {
        const plan = buildDumpPlan(opts);
        const chosen = await selectRunningProcess(target);
        if (!chosen) return;
        await captureDumps(chosen, plan);
      } catch (err) {
        console.error(`Dump failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

export default { register };
