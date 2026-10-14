import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isGeneratedBundle } from './packLayout.js';

export type ChangeKind = 'upgraded' | 'modified' | 'added' | 'removed';

export interface ArtifactChange {
  kind: ChangeKind;
  /** Directory relative to the pack root, e.g. repository/components/plugins. */
  dir: string;
  /** Artifact name without its version, e.g. org.wso2.carbon.apimgt.impl. */
  name: string;
  before: { file: string; version: string; size: number } | null;
  after: { file: string; version: string; size: number } | null;
}

export interface UpdateInfo {
  packLevel: number;
  backupDir: string;
  backupLevel: number;
  backupTakenAt: Date;
  /** Changelog the update tool wrote for exactly this level range, if present. */
  changelog: string | null;
}

export interface UpdateDiff extends UpdateInfo {
  compared: number;
  changes: ArtifactChange[];
}

export class UpdateDiffError extends Error {}

interface UpdateConfig {
  'update-level'?: string;
  product?: { pattern?: string; backup?: string };
}

function readUpdateConfig(packDir: string): UpdateConfig | null {
  const file = path.join(packDir, 'updates', 'config.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateConfig;
  } catch {
    throw new UpdateDiffError(`Could not parse ${file}.`);
  }
}

/** The update tool writes "-1" for a pack that has never been updated, i.e. the GA release. */
function updateLevel(config: UpdateConfig | null): number {
  const level = Number(config?.['update-level']);
  return Number.isInteger(level) && level > 0 ? level : 0;
}

function productPattern(packDir: string, config: UpdateConfig | null): string | null {
  const productFile = path.join(packDir, 'updates', 'product.txt');
  if (fs.existsSync(productFile)) return fs.readFileSync(productFile, 'utf8').trim();
  return config?.product?.pattern ?? null;
}

/**
 * Finds the backup the U2 update tool took before its last run. It records
 * the location in updates/config.json (`product.backup`), normally under
 * ~/.wso2-updates/backup/. `backupOverride` lets the caller compare against
 * an older backup instead.
 */
export function resolveUpdateInfo(packDir: string, backupOverride?: string): UpdateInfo {
  const config = readUpdateConfig(packDir);
  const recordedBackup = config?.product?.backup;
  if (!backupOverride && config && updateLevel(config) > 0 && !recordedBackup) {
    throw new UpdateDiffError(
      `${packDir} is at update level ${updateLevel(config)}, but the update tool has no backup recorded for it.\n` +
        'It was most likely unzipped from an already-updated download (e.g. wso2am-4.6.0.24.zip) rather than updated in place.\n' +
        'Run the update tool on it to get a backup, or compare with an older pack of the same product: --backup <dir>.'
    );
  }
  if (!backupOverride && (!config || updateLevel(config) === 0 || !recordedBackup)) {
    throw new UpdateDiffError(
      `${packDir} has not been updated with the U2 update tool yet, so there is no backup to compare against.\n` +
        'Run the update tool (bin/wso2update_<os>) on the pack first; it backs the pack up before applying updates.'
    );
  }

  const backupDir = path.resolve(backupOverride ?? recordedBackup!);
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
    throw new UpdateDiffError(
      backupOverride
        ? `Backup directory not found: ${backupDir}`
        : `The backup recorded in updates/config.json no longer exists:\n  ${backupDir}\n` +
            'Pass another backup of the same product with --backup <dir> (see ~/.wso2-updates/backup/).'
    );
  }

  const backupConfig = readUpdateConfig(backupDir);
  const packProduct = productPattern(packDir, config);
  const backupProduct = productPattern(backupDir, backupConfig);
  if (packProduct && backupProduct && packProduct !== backupProduct) {
    throw new UpdateDiffError(`The backup is of ${backupProduct}, but the pack is ${packProduct}.`);
  }

  const packLevel = updateLevel(config);
  const backupLevel = updateLevel(backupConfig);
  const pad = (n: number) => String(n).padStart(4, '0');
  const changelog = path.join(packDir, 'updates', `changelog-${pad(backupLevel)}-${pad(packLevel)}.md`);
  const stat = fs.statSync(backupDir);

  return {
    packLevel,
    backupDir,
    backupLevel,
    backupTakenAt: stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime,
    changelog: fs.existsSync(changelog) ? changelog : null,
  };
}

// Folders holding runtime state or the update tool's own files, not shipped artifacts.
const SKIPPED_TOP_LEVEL = new Set(['tmp', 'backup', 'updates', 'dry-run', 'hotfixes', 'docker', 'logs']);

function isSkippedDir(relativeDir: string, name: string, siblings: Set<string>): boolean {
  if (!relativeDir && SKIPPED_TOP_LEVEL.has(name)) return true;
  // OSGi's bundle cache holds runtime copies of the plugins.
  if (name === 'org.eclipse.osgi' && path.basename(relativeDir) === 'configuration') return true;
  if (name === 'logs' && relativeDir === 'repository') return true;
  // A webapp folder next to its .war is just the unpacked copy; the .war is what the update changes.
  return siblings.has(`${name}.war`);
}

/** Every .jar and .war in the pack, keyed by path relative to the pack root. */
function listArtifacts(packDir: string): Map<string, number> {
  const artifacts = new Map<string, number>();
  const walk = (relativeDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(packDir, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }
    const siblings = new Set(entries.map((e) => e.name));
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!isSkippedDir(relativeDir, entry.name, siblings)) walk(relativePath);
      } else if (entry.isFile() && /\.(jar|war)$/i.test(entry.name)) {
        if (path.basename(relativeDir) === 'dropins' && isGeneratedBundle(entry.name)) continue;
        artifacts.set(relativePath, fs.statSync(path.join(packDir, relativePath)).size);
      }
    }
  };
  walk('');
  return artifacts;
}

/**
 * Splits "org.wso2.carbon.apimgt.impl_9.29.120.jar" (OSGi plugin) or
 * "jackson-core-2.15.2.jar" (Maven) into name and version. The split is at
 * the last `_` or `-` followed by a digit, so "log4j-1.2-api-2.17.1" keeps
 * "log4j-1.2-api" as its name.
 */
export function splitArtifactName(file: string): { name: string; version: string } {
  const base = file.replace(/\.(jar|war)$/i, '');
  const separators = [...base.matchAll(/[_-](?=\d)/g)];
  const last = separators[separators.length - 1];
  if (!last || last.index === 0) return { name: base, version: '' };
  return { name: base.slice(0, last.index), version: base.slice(last.index! + 1) };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sameContent(a: string, b: string): boolean {
  const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return hash(a) === hash(b);
}

export function diffArtifacts(packDir: string, info: UpdateInfo): UpdateDiff {
  const before = listArtifacts(info.backupDir);
  const after = listArtifacts(packDir);
  const changes: ArtifactChange[] = [];
  const entry = (rel: string, size: number) => ({ file: path.basename(rel), version: splitArtifactName(path.basename(rel)).version, size });

  for (const [rel, size] of after) {
    const beforeSize = before.get(rel);
    if (beforeSize === undefined) continue;
    if (beforeSize !== size || !sameContent(path.join(info.backupDir, rel), path.join(packDir, rel))) {
      const { name } = splitArtifactName(path.basename(rel));
      changes.push({ kind: 'modified', dir: path.dirname(rel), name, before: entry(rel, beforeSize), after: entry(rel, size) });
    }
  }

  // Files only on one side: pair them up by directory + name to spot version upgrades.
  const removed = [...before].filter(([rel]) => !after.has(rel));
  const added = [...after].filter(([rel]) => !before.has(rel));
  const keyOf = (rel: string) => `${path.dirname(rel)}\u0000${splitArtifactName(path.basename(rel)).name}`;
  const addedByKey = new Map<string, [string, number][]>();
  for (const item of added) addedByKey.set(keyOf(item[0]), [...(addedByKey.get(keyOf(item[0])) ?? []), item]);

  const unmatchedRemoved: [string, number][] = [];
  for (const [rel, size] of removed) {
    const dir = path.dirname(rel);
    const { name } = splitArtifactName(path.basename(rel));
    const counterpart = addedByKey.get(keyOf(rel))?.shift();
    if (counterpart) {
      changes.push({ kind: 'upgraded', dir, name, before: entry(rel, size), after: entry(counterpart[0], counterpart[1]) });
    } else {
      unmatchedRemoved.push([rel, size]);
    }
  }

  // Second pass for re-releases that only append to the old version, e.g.
  // httpcore-nio_4.4.16.wso2v4.jar -> httpcore-nio_4.4.16.wso2v4_1.jar.
  const unmatchedAdded = [...addedByKey.values()].flat();
  for (const [rel, size] of unmatchedRemoved) {
    const dir = path.dirname(rel);
    const { name } = splitArtifactName(path.basename(rel));
    const counterpartIndex = unmatchedAdded.findIndex(
      ([addedRel]) => path.dirname(addedRel) === dir && new RegExp(`^${escapeRegExp(name)}[_-]\\d`).test(path.basename(addedRel))
    );
    if (counterpartIndex === -1) {
      changes.push({ kind: 'removed', dir, name, before: entry(rel, size), after: null });
      continue;
    }
    const [addedRel, addedSize] = unmatchedAdded.splice(counterpartIndex, 1)[0];
    const addedVersion = path.basename(addedRel).replace(/\.(jar|war)$/i, '').slice(name.length + 1);
    changes.push({ kind: 'upgraded', dir, name, before: entry(rel, size), after: { ...entry(addedRel, addedSize), version: addedVersion } });
  }
  for (const [rel, size] of unmatchedAdded) {
    changes.push({ kind: 'added', dir: path.dirname(rel), name: splitArtifactName(path.basename(rel)).name, before: null, after: entry(rel, size) });
  }

  changes.sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));
  return { ...info, compared: new Set([...before.keys(), ...after.keys()]).size, changes };
}
