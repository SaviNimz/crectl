import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The `java` binary a process was started with. WSO2 startup scripts pass
 * `-Djava.command=<path>`, which is more reliable than the first word of
 * the command line (that breaks on paths containing spaces).
 */
export function getJavaBinary(jvmCommand: string): string | null {
  const javaCommandFlag = jvmCommand.match(/-Djava\.command=(\S+)/);
  if (javaCommandFlag) return javaCommandFlag[1];

  const firstWord = jvmCommand.split(/\s+/)[0];
  return firstWord.endsWith('/java') ? firstWord : null;
}

/**
 * Finds a JDK tool (jcmd, keytool, ...) next to the given java binary, so
 * we attach with the same JDK the server runs on. Falls back to whatever
 * is on PATH.
 */
export function findJdkTool(toolName: string, javaBinary: string | null): string {
  if (javaBinary) {
    const siblingTool = path.join(path.dirname(javaBinary), toolName);
    if (fs.existsSync(siblingTool)) return siblingTool;
  }
  return toolName;
}

/** Version string from `java -version`, e.g. "17.0.20", or null if it can't be run. */
export function getJavaVersion(javaBinary: string): string | null {
  const result = spawnSync(javaBinary, ['-version'], { encoding: 'utf8' });
  const versionMatch = `${result.stderr}${result.stdout}`.match(/version "([^"]+)"/);
  return versionMatch?.[1] ?? null;
}

/** Initial and maximum heap flags from a JVM command line. */
export function getHeapSettings(jvmCommand: string): { initial: string | null; max: string | null } {
  return {
    initial: jvmCommand.match(/-Xms(\S+)/)?.[1] ?? null,
    max: jvmCommand.match(/-Xmx(\S+)/)?.[1] ?? null,
  };
}
