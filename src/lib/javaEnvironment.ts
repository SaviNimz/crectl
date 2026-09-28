import fs from 'node:fs';
import path from 'node:path';
import { getMacOsDefaultJdk, readJdkReleaseFile } from './jdkDiscovery.js';
import { getActiveJdkPath, JAVA_SYMLINK } from './jvmManager.js';
import { getJavaVersion } from './jdkTools.js';

// Apple's /usr/bin/java is a stub that runs JAVA_HOME's java, or macOS's default JDK if JAVA_HOME is unset.
const MACOS_JAVA_STUB = '/usr/bin/java';

export interface JdkLocation {
  /** The path as configured (may be a symlink, like ~/.crectl/java). */
  path: string;
  /** Where that path actually leads. */
  resolvedPath: string;
  version: string | null;
}

export interface JavaEnvironment {
  shell: {
    javaHome: JdkLocation | null;
    /** The `java` this terminal runs when you type `java`. */
    javaOnPath: JdkLocation | null;
    followsCrectl: boolean;
  };
  crectlGlobal: JdkLocation | null;
  macOsDefault: JdkLocation | null;
}

function resolvePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Describes a JDK home, reading its version from the `release` file. */
function describeJdkHome(jdkHome: string): JdkLocation {
  const resolvedPath = resolvePath(jdkHome);
  return { path: jdkHome, resolvedPath, version: readJdkReleaseFile(resolvedPath, '')?.version ?? null };
}

/** The first `java` executable on PATH, the same one the shell would run. */
function findJavaOnPath(pathVariable: string): string | null {
  for (const dir of pathVariable.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'java');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here — keep looking
    }
  }
  return null;
}

function describeJavaOnPath(): JdkLocation | null {
  const javaBinary = findJavaOnPath(process.env.PATH ?? '');
  if (!javaBinary) return null;

  // Run it rather than guessing from the path: for the macOS stub, only running it tells us which JDK it picks.
  const resolvedBinary = resolvePath(javaBinary);
  const resolvedPath = resolvedBinary === MACOS_JAVA_STUB ? MACOS_JAVA_STUB : path.dirname(path.dirname(resolvedBinary));
  return { path: javaBinary, resolvedPath, version: getJavaVersion(javaBinary) };
}

/**
 * Which Java is in effect, at each level: this terminal (JAVA_HOME and the
 * `java` on PATH — a CLI inherits both from the shell that ran it), the
 * crectl global symlink, and macOS's system default.
 */
export function getJavaEnvironment(): JavaEnvironment {
  const javaHome = process.env.JAVA_HOME;
  const activeJdkPath = getActiveJdkPath();
  const macOsDefault = getMacOsDefaultJdk();

  return {
    shell: {
      javaHome: javaHome ? describeJdkHome(javaHome) : null,
      javaOnPath: describeJavaOnPath(),
      followsCrectl: javaHome === JAVA_SYMLINK,
    },
    crectlGlobal: activeJdkPath ? describeJdkHome(activeJdkPath) : null,
    macOsDefault: macOsDefault ? describeJdkHome(macOsDefault.path) : null,
  };
}
