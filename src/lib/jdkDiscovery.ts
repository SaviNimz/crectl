import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface JdkInfo {
  version: string;
  /** Major version: 8 for "1.8.0_492", 17 for "17.0.20". */
  featureVersion: number;
  architecture: 'arm64' | 'x86_64' | string;
  path: string;
  /** Where it was found: "macOS" (java_home), "SDKMAN", "Homebrew", ... */
  source: string;
}

/**
 * The major Java version of a version string: "1.8.0_492" and "8" → 8,
 * "17.0.20" and "17" → 17. Returns null if it isn't a Java version.
 */
export function parseFeatureVersion(version: string): number | null {
  const legacyMatch = version.match(/^1\.(\d+)/);
  if (legacyMatch) return Number(legacyMatch[1]);
  const modernMatch = version.match(/^(\d+)/);
  return modernMatch ? Number(modernMatch[1]) : null;
}

/** Orders "17.0.20" after "17.0.9" and "1.8.0_492" after "1.8.0_45" (numeric, not alphabetical). */
export function compareJavaVersions(a: string, b: string): number {
  const numbersOf = (version: string) => (version.match(/\d+/g) ?? []).map(Number);
  const [aParts, bParts] = [numbersOf(a), numbersOf(b)];
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const difference = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** JDKs registered with macOS, via `/usr/libexec/java_home -V`. */
function listMacOsJdks(): JdkInfo[] {
  const result = spawnSync('/usr/libexec/java_home', ['-V'], { encoding: 'utf8' });
  const text = `${result.stdout}\n${result.stderr}`;

  const jdks: JdkInfo[] = [];
  for (const line of text.split('\n')) {
    // e.g. `    17.0.20 (arm64) "Eclipse Adoptium" - "OpenJDK 17.0.20" /Library/Java/.../Home`
    const match = line.match(/^\s*(\S+)\s+\((\S+)\).*?(\/\S.*)$/);
    if (!match) continue;
    const [, version, architecture, jdkPath] = match;
    const featureVersion = parseFeatureVersion(version);
    if (featureVersion === null) continue;
    jdks.push({ version, featureVersion, architecture, path: jdkPath.trim(), source: 'macOS' });
  }
  return jdks;
}

/**
 * Reads a JDK's `release` file (every JDK ships one), which records its
 * version and CPU architecture without having to run it.
 */
export function readJdkReleaseFile(jdkHome: string, source: string): JdkInfo | null {
  let releaseText: string;
  try {
    releaseText = fs.readFileSync(path.join(jdkHome, 'release'), 'utf8');
  } catch {
    return null;
  }
  const version = releaseText.match(/^JAVA_VERSION="([^"]+)"/m)?.[1];
  const featureVersion = version ? parseFeatureVersion(version) : null;
  if (!version || featureVersion === null || !fs.existsSync(path.join(jdkHome, 'bin', 'java'))) return null;

  const releaseArchitecture = releaseText.match(/^OS_ARCH="([^"]+)"/m)?.[1] ?? 'unknown';
  const architecture = releaseArchitecture === 'aarch64' ? 'arm64' : releaseArchitecture;
  return { version, featureVersion, architecture, path: jdkHome, source };
}

/** A JDK folder is either the home itself, or a macOS bundle with the home in Contents/Home. */
function findJdkHome(dir: string): string {
  const macBundleHome = path.join(dir, 'Contents', 'Home');
  return fs.existsSync(macBundleHome) ? macBundleHome : dir;
}

function listSubdirectories(dir: string): string[] {
  try {
    return fs.readdirSync(dir).map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}

/** JDKs installed by version managers that don't register them with macOS. */
function listToolManagedJdks(): JdkInfo[] {
  const home = os.homedir();
  const candidates: { dir: string; source: string }[] = [];

  // SDKMAN: `current` is a symlink to one of the others, so skip it.
  for (const dir of listSubdirectories(path.join(home, '.sdkman', 'candidates', 'java'))) {
    if (path.basename(dir) !== 'current') candidates.push({ dir, source: 'SDKMAN' });
  }
  for (const dir of listSubdirectories(path.join(home, '.asdf', 'installs', 'java'))) candidates.push({ dir, source: 'asdf' });
  for (const dir of listSubdirectories(path.join(home, '.local', 'share', 'mise', 'installs', 'java'))) candidates.push({ dir, source: 'mise' });
  for (const dir of listSubdirectories(path.join(home, '.jenv', 'versions'))) candidates.push({ dir, source: 'jenv' });

  // Homebrew formulae (openjdk, openjdk@17, ...) — Apple Silicon and Intel prefixes.
  for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt']) {
    for (const dir of listSubdirectories(prefix)) {
      if (/^openjdk(@\d+)?$/.test(path.basename(dir))) {
        candidates.push({ dir: path.join(dir, 'libexec', 'openjdk.jdk'), source: 'Homebrew' });
      }
    }
  }

  return candidates
    .map(({ dir, source }) => readJdkReleaseFile(findJdkHome(dir), source))
    .filter((jdk): jdk is JdkInfo => jdk !== null);
}

function realPathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Every JDK on this Mac, newest first: the ones macOS knows about plus the
 * ones managed by SDKMAN, asdf, mise, jenv and Homebrew. The same JDK
 * reached through different symlinks is listed once.
 */
export function listJdks(): JdkInfo[] {
  const seenRealPaths = new Set<string>();
  const uniqueJdks: JdkInfo[] = [];
  for (const jdk of [...listMacOsJdks(), ...listToolManagedJdks()]) {
    const realPath = realPathOrSelf(jdk.path);
    if (seenRealPaths.has(realPath)) continue;
    seenRealPaths.add(realPath);
    uniqueJdks.push(jdk);
  }
  return uniqueJdks.sort((a, b) => compareJavaVersions(b.version, a.version));
}

/**
 * The JDK that plain `/usr/libexec/java_home` — and therefore `/usr/bin/java`
 * and any profile doing `JAVA_HOME=$(/usr/libexec/java_home)` — resolves to,
 * or null if macOS has none registered.
 */
export function getMacOsDefaultJdk(): JdkInfo | null {
  const result = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' });
  const defaultHome = result.status === 0 ? result.stdout.trim() : '';
  return listMacOsJdks().find((jdk) => jdk.path === defaultHome) ?? null;
}
