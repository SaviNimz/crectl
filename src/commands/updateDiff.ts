import type { Command } from 'commander';
import os from 'node:os';
import path from 'node:path';
import { resolvePackTarget } from '../lib/targetResolver.js';
import { resolveProduct } from '../lib/productMap.js';
import { diffArtifacts, resolveUpdateInfo, UpdateDiffError, type ArtifactChange, type ChangeKind, type UpdateDiff } from '../lib/updateDiff.js';
import { formatBytes, printTable } from '../lib/format.js';

const CHANGE_KINDS: ChangeKind[] = ['upgraded', 'modified', 'added', 'removed'];

function describeLevel(level: number): string {
  return level === 0 ? 'GA (no updates)' : String(level);
}

function tildify(file: string): string {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

function sizeDelta(change: ArtifactChange): string {
  const before = change.before?.size ?? 0;
  const after = change.after?.size ?? 0;
  if (before === after) return 'same size';
  return `${after > before ? '+' : '-'}${formatBytes(Math.abs(after - before))}`;
}

function parseKinds(only: string | undefined): ChangeKind[] | null {
  if (!only) return CHANGE_KINDS;
  const kinds = only.split(',').map((k) => k.trim().toLowerCase());
  const unknown = kinds.filter((k) => !CHANGE_KINDS.includes(k as ChangeKind));
  if (unknown.length > 0) {
    console.error(`Unknown change type: ${unknown.join(', ')}. Use: ${CHANGE_KINDS.join(', ')}.`);
    process.exitCode = 1;
    return null;
  }
  return kinds as ChangeKind[];
}

function printReport(carbonHome: string, diff: UpdateDiff, changes: ArtifactChange[]): void {
  const { product, version } = resolveProduct(path.basename(carbonHome));
  console.log(`${product} ${version}: update level ${describeLevel(diff.backupLevel)} -> ${describeLevel(diff.packLevel)}`);
  console.log(`  Pack       ${carbonHome}`);
  console.log(`  Backup     ${tildify(diff.backupDir)} (taken ${diff.backupTakenAt.toLocaleString()})`);
  if (diff.changelog) console.log(`  Changelog  ${path.relative(carbonHome, diff.changelog)}`);

  const counts = CHANGE_KINDS.map((kind) => [kind, diff.changes.filter((c) => c.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`);
  console.log(
    `\n${diff.changes.length} of ${diff.compared} jars/wars changed` + (counts.length > 0 ? `: ${counts.join(', ')}` : '')
  );

  if (changes.length === 0) {
    if (diff.changes.length > 0) console.log('Nothing matches the given --only / --filter.');
    return;
  }

  const dirs = [...new Set(changes.map((c) => c.dir))];
  for (const dir of dirs) {
    const inDir = changes.filter((c) => c.dir === dir);
    console.log(`\n${dir}/  (${inDir.length})`);
    printTable(
      ['CHANGE', 'JAR / WAR', 'BEFORE', 'AFTER', 'SIZE'],
      inDir.map((c) => {
        // Unversioned files (wars, plain jars) are named in full; their version columns stay empty.
        const file = (c.after ?? c.before)!.file;
        const versioned = Boolean(c.before?.version || c.after?.version);
        return [
          c.kind,
          versioned ? c.name : file,
          c.before?.version || '-',
          c.after?.version || '-',
          sizeDelta(c),
        ];
      }),
      '  '
    );
  }
}

function register(program: Command): void {
  program
    .command('update-diff <target>')
    .alias('u2-diff')
    .description('Show which jars a U2 update changed, by comparing the pack with the backup the update tool took')
    .option('--backup <dir>', 'compare against this backup instead of the one in updates/config.json')
    .option('--only <types>', `only these change types, comma-separated: ${CHANGE_KINDS.join(', ')}`)
    .option('--filter <text>', 'only jars whose folder or name contains this text')
    .option('--json', 'output as JSON')
    .addHelpText(
      'after',
      `
Change types:
  upgraded  the jar's version changed (old file replaced by a new version)
  modified  same file name, different content (patched in place)
  added     only in the updated pack
  removed   only in the backup

The update tool (bin/wso2update_<os>) backs the pack up to ~/.wso2-updates/backup/
before applying updates and records where in updates/config.json. This command
compares the pack against that backup, so it only works on an updated pack.

Examples:
  crectl update-diff ./wso2am-4.5.0
  crectl update-diff am --only upgraded,added
  crectl update-diff am --filter apimgt
  crectl update-diff am --backup ~/.wso2-updates/backup/wso2am-4.5.0-<id>   compare with an older backup`
    )
    .action(async (target: string, opts) => {
      const kinds = parseKinds(opts.only);
      if (!kinds) return;

      const resolved = await resolvePackTarget(target);
      if (!resolved) return;
      const { carbonHome } = resolved;

      let diff: UpdateDiff;
      try {
        diff = diffArtifacts(carbonHome, resolveUpdateInfo(carbonHome, opts.backup));
      } catch (err) {
        if (!(err instanceof UpdateDiffError)) throw err;
        console.error(err.message);
        process.exitCode = 1;
        return;
      }

      const filter = opts.filter?.toLowerCase();
      const changes = diff.changes.filter(
        (c) => kinds.includes(c.kind) && (!filter || `${c.dir}/${c.name}`.toLowerCase().includes(filter))
      );

      if (opts.json) {
        console.log(JSON.stringify({ carbonHome, ...diff, changes }, null, 2));
        return;
      }
      printReport(carbonHome, diff, changes);
    });
}

export default { register };
