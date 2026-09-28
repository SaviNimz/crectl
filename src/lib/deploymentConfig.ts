import fs from 'node:fs';
import { parse } from 'smol-toml';
import { getPackLayout } from './packLayout.js';

export type TomlTable = Record<string, unknown>;

export interface DeploymentConfig {
  tomlPath: string;
  /** Parsed deployment.toml, or an empty table if it's missing or unparseable. */
  config: TomlTable;
  error?: string;
}

export function readDeploymentConfig(carbonHome: string): DeploymentConfig {
  const tomlPath = getPackLayout(carbonHome).deploymentToml;
  if (!fs.existsSync(tomlPath)) {
    return { tomlPath, config: {}, error: 'deployment.toml not found' };
  }
  try {
    return { tomlPath, config: parse(fs.readFileSync(tomlPath, 'utf8')) };
  } catch (err) {
    const firstLine = (err as Error).message.split('\n')[0];
    return { tomlPath, config: {}, error: `could not parse deployment.toml: ${firstLine}` };
  }
}

/** Reads a nested value like `getTomlValue(config, 'server', 'offset')`, or undefined if any step is missing. */
export function getTomlValue(table: TomlTable, ...keys: string[]): unknown {
  let current: unknown = table;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as TomlTable)[key];
  }
  return current;
}

export function getTomlString(table: TomlTable, ...keys: string[]): string | undefined {
  const value = getTomlValue(table, ...keys);
  return typeof value === 'string' ? value : undefined;
}

export interface PortOffset {
  value: number;
  source: 'JVM flag (-DportOffset)' | 'deployment.toml [server] offset' | 'product default';
}

/**
 * Works out the port offset the same way the server does: a
 * `-DportOffset` JVM flag wins over `[server] offset` in deployment.toml,
 * which wins over the product's built-in default.
 */
export function resolvePortOffset(carbonHome: string, jvmCommand: string, productDefault: number): PortOffset {
  const jvmFlagMatch = jvmCommand.match(/-DportOffset=(\d+)/);
  if (jvmFlagMatch) {
    return { value: Number(jvmFlagMatch[1]), source: 'JVM flag (-DportOffset)' };
  }

  const tomlOffset = getTomlValue(readDeploymentConfig(carbonHome).config, 'server', 'offset');
  const parsedTomlOffset = Number(tomlOffset);
  if (tomlOffset !== undefined && Number.isInteger(parsedTomlOffset)) {
    return { value: parsedTomlOffset, source: 'deployment.toml [server] offset' };
  }

  return { value: productDefault, source: 'product default' };
}
