import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFeatureVersion, type JdkInfo } from './jdkDiscovery.js';

const CRECTL_DIR = path.join(os.homedir(), '.crectl');
export const JAVA_SYMLINK = path.join(CRECTL_DIR, 'java');

export function assertMac(): void {
  if (process.platform !== 'darwin') {
    throw new Error('crectl jvm currently only supports macOS.');
  }
}

/** True for a bare major version like "21", "8" or "1.8", as opposed to an exact one like "17.0.20". */
export function isMajorVersionOnly(version: string): boolean {
  return /^(1\.)?\d+$/.test(version);
}

/**
 * Finds an installed JDK for the requested version. A major version ("11",
 * "1.8") picks the newest installed JDK of that major version, preferring
 * one built for this Mac's CPU over one that needs Rosetta; an exact
 * version ("17.0.20") must match exactly.
 *
 * We match ourselves rather than asking `java_home -v`, because java_home
 * treats the version as a minimum: `java_home -v 11` returns any newer JDK
 * when 11 itself isn't installed.
 */
export function findInstalledJdk(requestedVersion: string, jdks: JdkInfo[]): JdkInfo | null {
  if (!isMajorVersionOnly(requestedVersion)) {
    return jdks.find((jdk) => jdk.version === requestedVersion) ?? null;
  }

  const featureVersion = parseFeatureVersion(requestedVersion);
  const matchingJdks = jdks.filter((jdk) => jdk.featureVersion === featureVersion);
  const nativeArchitecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  return matchingJdks.find((jdk) => jdk.architecture === nativeArchitecture) ?? matchingJdks[0] ?? null;
}

/** Path the `~/.crectl/java` symlink currently points to, or null if unset. */
export function getActiveJdkPath(): string | null {
  try {
    return fs.readlinkSync(JAVA_SYMLINK);
  } catch {
    return null;
  }
}

/**
 * Repoints `~/.crectl/java` at the given JDK home. This is the only way a
 * CLI process can affect the "global" JVM version, since a subprocess
 * cannot mutate its parent shell's environment — the user's shell profile
 * must point JAVA_HOME at this stable symlink once.
 */
export function switchToJdk(jdkHome: string): void {
  fs.mkdirSync(CRECTL_DIR, { recursive: true });
  try {
    fs.unlinkSync(JAVA_SYMLINK);
  } catch {
    // no existing symlink — fine
  }
  fs.symlinkSync(jdkHome, JAVA_SYMLINK);
}

/** Whether the shell that ran this command takes JAVA_HOME from the crectl symlink. */
export function isShellUsingCrectlJava(): boolean {
  return process.env.JAVA_HOME === JAVA_SYMLINK;
}
