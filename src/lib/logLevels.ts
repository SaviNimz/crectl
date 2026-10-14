import fs from 'node:fs';
import path from 'node:path';
import { getPackLayout } from './packLayout.js';

export const LOG_LEVELS = ['OFF', 'FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'ALL'];

export interface LogPreset {
  description: string;
  products: string[];
  loggers: string[];
}

const GATEWAY_PRODUCTS = ['API Manager', 'Universal Gateway', 'Micro Integrator'];
const API_MANAGER_PRODUCTS = ['API Manager', 'API Control Plane', 'Universal Gateway', 'Traffic Manager'];
const IDENTITY_PRODUCTS = ['Identity Server', 'Identity Server KM', 'API Manager', 'API Control Plane'];

/** Logger sets for the usual debugging scenarios, so nobody has to remember package names. */
export const LOG_PRESETS: Record<string, LogPreset> = {
  wire: {
    description: 'HTTP wire logs: raw headers and payloads in and out of the gateway',
    products: GATEWAY_PRODUCTS,
    loggers: ['org.apache.synapse.transport.http.wire', 'org.apache.synapse.transport.http.headers'],
  },
  passthru: {
    description: 'Pass-through HTTP transport: connections, timeouts, socket errors',
    products: GATEWAY_PRODUCTS,
    loggers: ['org.apache.synapse.transport.passthru'],
  },
  synapse: {
    description: 'Mediation engine: sequences, mediators, endpoints (noisy)',
    products: GATEWAY_PRODUCTS,
    loggers: ['org.apache.synapse'],
  },
  'gateway-auth': {
    description: 'Gateway authentication: OAuth, JWT and API key validation',
    products: ['API Manager', 'Universal Gateway'],
    loggers: ['org.wso2.carbon.apimgt.gateway.handlers.security'],
  },
  throttling: {
    description: 'Gateway throttling decisions',
    products: ['API Manager', 'Universal Gateway'],
    loggers: ['org.wso2.carbon.apimgt.gateway.handlers.throttling'],
  },
  keymanager: {
    description: 'Key manager calls: token validation, key generation, KM client',
    products: API_MANAGER_PRODUCTS,
    loggers: ['org.wso2.carbon.apimgt.keymgt', 'org.wso2.carbon.apimgt.impl.kmclient'],
  },
  oauth: {
    description: 'OAuth2 / OIDC token issuance and validation',
    products: IDENTITY_PRODUCTS,
    loggers: ['org.wso2.carbon.identity.oauth2', 'org.wso2.carbon.identity.oauth'],
  },
  saml: {
    description: 'SAML SSO, both as identity provider and as federated authenticator',
    products: IDENTITY_PRODUCTS,
    loggers: ['org.wso2.carbon.identity.sso.saml', 'org.wso2.carbon.identity.application.authenticator.samlsso'],
  },
  authn: {
    description: 'Authentication framework: login flows, steps, federated IdPs',
    products: IDENTITY_PRODUCTS,
    loggers: ['org.wso2.carbon.identity.application.authentication.framework'],
  },
  userstore: {
    description: 'User store managers: JDBC / LDAP / AD lookups and authentication',
    products: [...IDENTITY_PRODUCTS, 'Micro Integrator'],
    loggers: ['org.wso2.carbon.user.core'],
  },
  scim: {
    description: 'SCIM 2.0 user and group provisioning',
    products: ['Identity Server', 'API Manager'],
    loggers: ['org.wso2.carbon.identity.scim2', 'org.wso2.charon3.core'],
  },
};

export interface LoggerOverride {
  logger: string;
  level: string;
  /** Level the pack's own config gives this logger, or null if it isn't declared there (inherits from its parent). */
  packLevel: string | null;
}

const BLOCK_START = '# >>> crectl log-level overrides (remove with: crectl log-level <pack> --reset)';
const BLOCK_END = '# <<< crectl log-level overrides';

type Properties = Map<string, string>;

/**
 * Minimal Java .properties reader: enough for log4j2.properties, which only
 * uses `key = value` pairs, comments, and backslash line continuations (MI
 * splits its `loggers` list over many lines). Later keys win, as in Java.
 */
function parseProperties(text: string): Properties {
  const props: Properties = new Map();
  let pending = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = pending ? rawLine.trimStart() : rawLine;
    if (!pending && /^\s*([#!]|$)/.test(line)) continue;

    const trailingBackslashes = line.match(/\\*$/)![0].length;
    if (trailingBackslashes % 2 === 1) {
      pending += line.slice(0, -1);
      continue;
    }
    const logicalLine = pending + line;
    pending = '';

    const match = logicalLine.match(/^\s*([^=:\s]+)\s*[=:\s]\s*(.*?)\s*$/);
    if (match) props.set(match[1], match[2]);
  }
  return props;
}

/**
 * Splits the file into the pack's own config and crectl's managed block.
 * Removal is the exact inverse of `save`: one newline before the block and
 * one after it, so a reset leaves the file byte-for-byte as it was.
 */
function splitManagedBlock(text: string): { base: string; block: string } {
  const start = text.indexOf(BLOCK_START);
  if (start === -1) return { base: text, block: '' };
  const endMarker = text.indexOf(BLOCK_END, start);
  const end = endMarker === -1 ? text.length : endMarker + BLOCK_END.length;
  const cutStart = text[start - 1] === '\n' ? start - 1 : start;
  const cutEnd = text[end] === '\n' ? end + 1 : end;
  return { base: text.slice(0, cutStart) + text.slice(cutEnd), block: text.slice(start, end) };
}

/** Maps each logger *name* (e.g. org.apache.synapse) to its properties key (e.g. synapse). */
function loggerKeysByName(props: Properties): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [key, value] of props) {
    const match = key.match(/^logger\.([^.]+)\.name$/);
    if (match) keys.set(value, match[1]);
  }
  return keys;
}

function readOverrides(base: Properties, blockProps: Properties): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const [key, level] of blockProps) {
    const match = key.match(/^logger\.([^.]+)\.level$/);
    if (!match) continue;
    const name = blockProps.get(`logger.${match[1]}.name`) ?? base.get(`logger.${match[1]}.name`);
    if (name) overrides.set(name, level);
  }
  return overrides;
}

function renderBlock(base: Properties, overrides: Map<string, string>): string {
  if (overrides.size === 0) return '';

  const existingKeys = loggerKeysByName(base);
  const declaredLoggers = base.get('loggers');
  const activeKeys = new Set((declaredLoggers ?? '').split(',').map((k) => k.trim()).filter(Boolean));
  const keysToActivate: string[] = [];
  const lines = [BLOCK_START];

  for (const [name, level] of overrides) {
    const existingKey = existingKeys.get(name);
    // Re-level a logger the pack already declares; Java properties let the later line win.
    const key = existingKey ?? `crectl-${name.replace(/[^A-Za-z0-9]/g, '-')}`;
    if (!existingKey) lines.push(`logger.${key}.name = ${name}`);
    lines.push(`logger.${key}.level = ${level}`);
    if (!activeKeys.has(key)) keysToActivate.push(key);
  }

  // When the file lists its loggers explicitly, anything not in that list is ignored.
  if (declaredLoggers !== undefined && keysToActivate.length > 0) {
    lines.push(`loggers = ${[declaredLoggers, ...keysToActivate].filter(Boolean).join(', ')}`);
  }
  lines.push(BLOCK_END);
  return lines.join('\n');
}

export interface LogConfig {
  file: string;
  overrides: LoggerOverride[];
}

function describe(file: string, base: Properties, overrides: Map<string, string>): LogConfig {
  const existingKeys = loggerKeysByName(base);
  return {
    file,
    overrides: [...overrides].map(([logger, level]) => {
      const key = existingKeys.get(logger);
      return { logger, level, packLevel: key ? base.get(`logger.${key}.level`) ?? null : null };
    }),
  };
}

function load(carbonHome: string) {
  const file = getPackLayout(carbonHome).log4j2Properties;
  if (!fs.existsSync(file)) throw new Error(`${file} not found`);
  const { base, block } = splitManagedBlock(fs.readFileSync(file, 'utf8'));
  const baseProps = parseProperties(base);
  return { file, base, baseProps, overrides: readOverrides(baseProps, parseProperties(block)) };
}

/** Writes via a temp file + rename so the server's config watcher never reads a half-written file. */
function save(file: string, base: string, baseProps: Properties, overrides: Map<string, string>): void {
  const block = renderBlock(baseProps, overrides);
  const content = block ? `${base}\n${block}\n` : base;
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.crectl-tmp`);
  fs.writeFileSync(tempFile, content, { mode: fs.statSync(file).mode });
  fs.renameSync(tempFile, file);
}

export function readLogConfig(carbonHome: string): LogConfig {
  const { file, baseProps, overrides } = load(carbonHome);
  return describe(file, baseProps, overrides);
}

export function setLogLevels(carbonHome: string, loggers: string[], level: string): LogConfig {
  const { file, base, baseProps, overrides } = load(carbonHome);
  for (const logger of loggers) overrides.set(logger, level);
  save(file, base, baseProps, overrides);
  return describe(file, baseProps, overrides);
}

/** Removes the given overrides, or all of them when `loggers` is empty, restoring the pack's own levels. */
export function resetLogLevels(carbonHome: string, loggers: string[]): LogConfig {
  const { file, base, baseProps, overrides } = load(carbonHome);
  if (loggers.length === 0) overrides.clear();
  for (const logger of loggers) overrides.delete(logger);
  save(file, base, baseProps, overrides);
  return describe(file, baseProps, overrides);
}
