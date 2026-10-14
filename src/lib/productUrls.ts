import { resolvePortOffset } from './deploymentConfig.js';
import { getPortProfile } from './productPorts.js';
import type { WSO2Process } from '../types.js';

export interface IdentityServerUrls {
  console: string | null;
  myaccount: string | null;
  carbon: string | null;
}

export interface MicroIntegratorUrls {
  management: string | null;
  http: string | null;
  https: string | null;
}

function parseVersion(version: string): [major: number, minor: number] {
  const match = version.match(/^(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : [0, 0];
}

/**
 * The port a product's `basePort` actually lands on, after the offset is
 * resolved the same way the server resolves it (JVM flag, then
 * deployment.toml, then the product default). Returns null when the
 * process isn't listening there, so we never print a dead URL.
 */
function resolveListeningPort(p: WSO2Process, basePort: number): number | null {
  const { defaultOffset } = getPortProfile(p.product, p.version);
  const port = basePort + resolvePortOffset(p.carbonHome, p.command, defaultOffset).value;
  return p.ports.includes(port) ? port : null;
}

const IDENTITY_SERVER_PRODUCTS = ['Identity Server', 'Identity Server KM'];

/** Returns null for products that aren't Identity Server. */
export function getIdentityServerUrls(p: WSO2Process): IdentityServerUrls | null {
  if (!IDENTITY_SERVER_PRODUCTS.includes(p.product)) return null;

  const port = resolveListeningPort(p, 9443);
  if (!port) return { console: null, myaccount: null, carbon: null };

  // Console and My Account arrived in IS 5.10. The Carbon management
  // console is deprecated in IS 7 but still served. An unparseable version
  // is treated as current.
  const [major, minor] = parseVersion(p.version);
  const hasNewPortals = major === 0 || major > 5 || (major === 5 && minor >= 10);
  return {
    console: hasNewPortals ? `https://localhost:${port}/console` : null,
    myaccount: hasNewPortals ? `https://localhost:${port}/myaccount` : null,
    carbon: `https://localhost:${port}/carbon`,
  };
}

/** Returns null for products that aren't Micro Integrator. */
export function getMicroIntegratorUrls(p: WSO2Process): MicroIntegratorUrls | null {
  if (p.product !== 'Micro Integrator') return null;

  const managementPort = resolveListeningPort(p, 9154);
  const httpPort = resolveListeningPort(p, 8280);
  const httpsPort = resolveListeningPort(p, 8243);
  return {
    management: managementPort ? `https://localhost:${managementPort}/management` : null,
    http: httpPort ? `http://localhost:${httpPort}` : null,
    https: httpsPort ? `https://localhost:${httpsPort}` : null,
  };
}
