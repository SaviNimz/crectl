import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getPackLayout } from './packLayout.js';
import { readDeploymentConfig, getTomlString, getTomlValue, resolvePortOffset, type PortOffset, type TomlTable } from './deploymentConfig.js';
import { resolveProduct } from './productMap.js';
import { getPortProfile } from './productPorts.js';
import { findJdkTool, getHeapSettings, getJavaBinary, getJavaVersion } from './jdkTools.js';
import type { WSO2Process } from '../types.js';

const DEFAULT_KEYSTORE_PASSWORD = 'wso2carbon';
const DEFAULT_KEY_ALIAS = 'wso2carbon';
const CERT_EXPIRY_WARNING_DAYS = 30;
const GENERATED_BUNDLE_SUFFIX = /_1\.0\.0\.jar$/;

export interface RuntimeInfo {
  running: boolean;
  pid?: number;
  uptime?: string;
  javaBinary: string | null;
  javaVersion: string | null;
  heapInitial?: string | null;
  heapMax?: string | null;
}

export interface DatasourceInfo {
  name: string;
  type: string;
  url: string;
  username: string;
}

export interface KeystoreInfo {
  role: string;
  file: string;
  exists: boolean;
  certificateSubject?: string;
  certificateExpiry?: string;
  daysUntilExpiry?: number;
  entryCount?: number;
  note?: string;
}

export interface PackReport {
  product: string;
  version: string;
  carbonHome: string;
  runtime: RuntimeInfo;
  updateLevel: string | null;
  portOffset: PortOffset;
  /** The product's main port after the offset, e.g. 9443 management HTTPS for Carbon products. */
  primaryPort: { port: number; purpose: string };
  deploymentToml: string;
  deploymentTomlError?: string;
  datasources: DatasourceInfo[];
  keyManager: string | null;
  gatewayEnvironments: { name: string; type: string; serviceUrl: string }[];
  keystores: KeystoreInfo[];
  extensions: {
    lib: string[];
    dropins: string[];
    /** Bundles Carbon auto-generates in dropins/ from lib/ jars (named like foo_1.2.3_1.0.0.jar). */
    generatedBundles: string[];
    patches: string[];
  };
}

function buildRuntimeInfo(runningProcess: WSO2Process | null): RuntimeInfo {
  if (!runningProcess) {
    // Not running: report the JDK it would start with.
    const javaHome = process.env.JAVA_HOME;
    const javaBinary = javaHome ? path.join(javaHome, 'bin', 'java') : null;
    return { running: false, javaBinary, javaVersion: javaBinary ? getJavaVersion(javaBinary) : null };
  }
  const javaBinary = getJavaBinary(runningProcess.command);
  const heap = getHeapSettings(runningProcess.command);
  return {
    running: true,
    pid: runningProcess.pid,
    uptime: runningProcess.etime,
    javaBinary,
    javaVersion: javaBinary ? getJavaVersion(javaBinary) : null,
    heapInitial: heap.initial,
    heapMax: heap.max,
  };
}

/** Update level recorded by the WSO2 Updates 2.0 tool, or null for a pack that was never updated. */
function readUpdateLevel(updatesDir: string): string | null {
  try {
    const updateConfig = JSON.parse(fs.readFileSync(path.join(updatesDir, 'config.json'), 'utf8'));
    return updateConfig['update-level'] ? String(updateConfig['update-level']) : null;
  } catch {
    return null;
  }
}

/** Hides `password=...` style parameters that some JDBC URLs carry inline. */
function maskJdbcUrlCredentials(url: string): string {
  return url.replace(/(password=)[^;&]*/gi, '$1****');
}

function listDatasources(config: TomlTable): DatasourceInfo[] {
  const databases = getTomlValue(config, 'database');
  if (typeof databases !== 'object' || databases === null) return [];

  return Object.entries(databases as TomlTable)
    .filter(([, value]) => typeof value === 'object' && value !== null && ('url' in value || 'type' in value))
    .map(([name, value]) => {
      const datasource = value as TomlTable;
      return {
        name,
        type: String(datasource.type ?? '-'),
        url: maskJdbcUrlCredentials(String(datasource.url ?? '-')),
        username: String(datasource.username ?? '-'),
      };
    });
}

function describeKeyManager(config: TomlTable): string | null {
  const keyManager = getTomlValue(config, 'apim', 'key_manager');
  if (keyManager === undefined) return null;
  const serviceUrl = getTomlString(config, 'apim', 'key_manager', 'service_url');
  const type = getTomlString(config, 'apim', 'key_manager', 'type');
  return serviceUrl ? `${type ?? 'external'} at ${serviceUrl}` : 'Resident Key Manager (built-in)';
}

function listGatewayEnvironments(config: TomlTable): PackReport['gatewayEnvironments'] {
  const environments = getTomlValue(config, 'apim', 'gateway', 'environment');
  if (!Array.isArray(environments)) return [];
  return environments.map((env: TomlTable) => ({
    name: String(env.name ?? '-'),
    type: String(env.type ?? '-'),
    serviceUrl: String(env.service_url ?? '-'),
  }));
}

/** Resolves a keystore password from deployment.toml, which may reference an env var or Secure Vault. */
function resolveKeystorePassword(rawPassword: string | undefined): { password?: string; note?: string } {
  if (rawPassword === undefined) return { password: DEFAULT_KEYSTORE_PASSWORD };
  if (rawPassword.startsWith('$secret{')) return { note: 'password is encrypted with Secure Vault — not checked' };

  const envReference = rawPassword.match(/^\$env\{(.+)\}$/);
  if (envReference) {
    const envValue = process.env[envReference[1]];
    return envValue ? { password: envValue } : { note: `password comes from $${envReference[1]}, which is not set — not checked` };
  }
  if (rawPassword.startsWith('$')) return { note: `password is a placeholder (${rawPassword}) — not checked` };
  return { password: rawPassword };
}

/** deployment.toml file names can be bare ("wso2carbon.jks"), pack-relative, or absolute. */
function resolveKeystorePath(fileName: string, carbonHome: string, securityDir: string): string {
  if (path.isAbsolute(fileName)) return fileName;
  if (fileName.includes('/')) return path.join(carbonHome, fileName);
  return path.join(securityDir, fileName);
}

/** When deployment.toml doesn't name the file, use whichever default exists (IS 7 ships .p12, older packs .jks). */
function defaultKeystoreFile(securityDir: string, baseName: string): string {
  const pkcs12File = `${baseName}.p12`;
  return fs.existsSync(path.join(securityDir, pkcs12File)) ? pkcs12File : `${baseName}.jks`;
}

function runKeytool(keytoolPath: string, args: string[], password: string): { ok: boolean; output: string } {
  // Pass the password through the environment so it never shows up in `ps`.
  const result = spawnSync(keytoolPath, [...args, '-storepass:env', 'CRECTL_STORE_PASSWORD'], {
    encoding: 'utf8',
    env: { ...process.env, CRECTL_STORE_PASSWORD: password },
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function inspectKeystore(
  role: string,
  keystoreConfig: TomlTable,
  defaultBaseName: string,
  withCertificate: boolean,
  context: { carbonHome: string; securityDir: string; keytoolPath: string }
): KeystoreInfo {
  const fileName = String(keystoreConfig.file_name ?? defaultKeystoreFile(context.securityDir, defaultBaseName));
  const file = resolveKeystorePath(fileName, context.carbonHome, context.securityDir);
  const info: KeystoreInfo = { role, file, exists: fs.existsSync(file) };
  if (!info.exists) return info;

  const { password, note } = resolveKeystorePassword(keystoreConfig.password as string | undefined);
  if (!password) return { ...info, note };

  const storeTypeArgs = keystoreConfig.type ? ['-storetype', String(keystoreConfig.type)] : [];
  const listing = runKeytool(context.keytoolPath, ['-list', '-keystore', file, ...storeTypeArgs], password);
  if (!listing.ok) return { ...info, note: `keytool could not open it: ${listing.output.trim().split('\n')[0]}` };
  const entryCountMatch = listing.output.match(/contains (\d+) entr/);
  if (entryCountMatch) info.entryCount = Number(entryCountMatch[1]);

  if (withCertificate) {
    const alias = String(keystoreConfig.alias ?? DEFAULT_KEY_ALIAS);
    const exported = runKeytool(context.keytoolPath, ['-exportcert', '-rfc', '-alias', alias, '-keystore', file, ...storeTypeArgs], password);
    if (!exported.ok) return { ...info, note: `alias "${alias}" not found` };

    const pemStart = exported.output.indexOf('-----BEGIN CERTIFICATE-----');
    if (pemStart === -1) return { ...info, note: 'could not read the certificate' };

    const certificate = new X509Certificate(exported.output.slice(pemStart));
    const expiry = new Date(certificate.validTo);
    info.certificateSubject = certificate.subject.replace(/\n/g, ', ');
    info.certificateExpiry = expiry.toISOString().slice(0, 10);
    info.daysUntilExpiry = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
    if (info.daysUntilExpiry < 0) info.note = 'CERTIFICATE HAS EXPIRED';
    else if (info.daysUntilExpiry < CERT_EXPIRY_WARNING_DAYS) info.note = 'certificate expires soon';
  }
  return info;
}

function listKeystores(config: TomlTable, carbonHome: string, securityDir: string, javaBinary: string | null): KeystoreInfo[] {
  const context = { carbonHome, securityDir, keytoolPath: findJdkTool('keytool', javaBinary) };
  const asTable = (value: unknown): TomlTable => (typeof value === 'object' && value !== null ? (value as TomlTable) : {});

  const primaryConfig = asTable(getTomlValue(config, 'keystore', 'primary'));
  const keystores = [inspectKeystore('Primary keystore', primaryConfig, 'wso2carbon', true, context)];

  const tlsConfig = getTomlValue(config, 'keystore', 'tls');
  if (tlsConfig !== undefined) {
    // [keystore.tls] only overrides what it sets; the rest is inherited from the primary keystore.
    keystores.push(inspectKeystore('TLS keystore', { ...primaryConfig, ...asTable(tlsConfig) }, 'wso2carbon', true, context));
  }

  keystores.push(inspectKeystore('Truststore', asTable(getTomlValue(config, 'truststore')), 'client-truststore', false, context));
  return keystores;
}

function listDirectoryEntries(dir: string, filter: (name: string) => boolean): string[] {
  try {
    return fs.readdirSync(dir).filter(filter).sort();
  } catch {
    return [];
  }
}

/** Builds a snapshot of a pack's setup; `runningProcess` adds live runtime details when the pack is running. */
export function inspectPack(carbonHome: string, runningProcess: WSO2Process | null): PackReport {
  const layout = getPackLayout(carbonHome);
  const { product, version } = resolveProduct(path.basename(carbonHome));
  const { tomlPath, config, error } = readDeploymentConfig(carbonHome);
  const runtime = buildRuntimeInfo(runningProcess);
  const portProfile = getPortProfile(product, version);
  const portOffset = resolvePortOffset(carbonHome, runningProcess?.command ?? '', portProfile.defaultOffset);
  const isJar = (name: string) => name.endsWith('.jar');
  const isGeneratedBundle = (name: string) => GENERATED_BUNDLE_SUFFIX.test(name);
  const dropinJars = listDirectoryEntries(layout.dropinsDir, isJar);

  return {
    product,
    version,
    carbonHome,
    runtime,
    updateLevel: readUpdateLevel(layout.updatesDir),
    portOffset,
    primaryPort: { port: portProfile.ports[0].basePort + portOffset.value, purpose: portProfile.ports[0].purpose },
    deploymentToml: tomlPath,
    deploymentTomlError: error,
    datasources: listDatasources(config),
    keyManager: describeKeyManager(config),
    gatewayEnvironments: listGatewayEnvironments(config),
    keystores: listKeystores(config, carbonHome, layout.securityDir, runtime.javaBinary),
    extensions: {
      lib: listDirectoryEntries(layout.libDir, isJar),
      dropins: dropinJars.filter((name) => !isGeneratedBundle(name)),
      generatedBundles: dropinJars.filter(isGeneratedBundle),
      patches: listDirectoryEntries(layout.patchesDir, (name) => !name.startsWith('.')),
    },
  };
}
