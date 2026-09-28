import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WSO2CTL_DIR = path.join(os.homedir(), '.wso2ctl');
const JAVA_SYMLINK = path.join(WSO2CTL_DIR, 'java');

export interface JdkInfo {
  version: string;
  path: string;
}

function assertMac(): void {
  if (process.platform !== 'darwin') {
    throw new Error('wso2ctl jvm currently only supports macOS (uses /usr/libexec/java_home).');
  }
}

/** Lists installed JDKs via `/usr/libexec/java_home -V` (macOS only). */
export function listJdks(): JdkInfo[] {
  assertMac();
  const result = spawnSync('/usr/libexec/java_home', ['-V'], { encoding: 'utf8' });
  const text = `${result.stdout}\n${result.stderr}`;

  const jdks: JdkInfo[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\S+)\s+.*?(\/\S.*)$/);
    if (!match) continue;
    const [, version, jdkPath] = match;
    jdks.push({ version, path: jdkPath.trim() });
  }
  return jdks;
}

function resolveJdkPath(version: string): string {
  assertMac();
  const result = spawnSync('/usr/libexec/java_home', ['-v', version], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`No installed JDK matches version "${version}". Run "wso2ctl jvm list" to see what's available.`);
  }
  return result.stdout.trim();
}

/** Path the `~/.wso2ctl/java` symlink currently points to, or null if unset. */
export function getActiveJdkPath(): string | null {
  try {
    return fs.readlinkSync(JAVA_SYMLINK);
  } catch {
    return null;
  }
}

/**
 * Repoints `~/.wso2ctl/java` at the requested JDK version. This is the
 * only way a CLI process can affect the "global" JVM version, since a
 * subprocess cannot mutate its parent shell's environment — the user's
 * shell profile must point JAVA_HOME at this stable symlink once.
 */
export function useJdk(version: string): string {
  const resolved = resolveJdkPath(version);
  fs.mkdirSync(WSO2CTL_DIR, { recursive: true });
  try {
    fs.unlinkSync(JAVA_SYMLINK);
  } catch {
    // no existing symlink — fine
  }
  fs.symlinkSync(resolved, JAVA_SYMLINK);
  return resolved;
}
