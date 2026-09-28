import type { WSO2Process } from '../types.js';

export interface PortalUrls {
  admin: string | null;
  publisher: string | null;
  devportal: string | null;
}

/**
 * Admin, Publisher and the Developer Portal are all served on the same
 * Carbon HTTPS transport port (default 9443), just under different URL
 * paths — they are not separate ports. That port shifts with
 * `-DportOffset=<n>` when several instances run side by side, so we
 * resolve the real listening port rather than assuming 9443.
 */
function resolveTransportPort(p: WSO2Process): number | null {
  const offsetMatch = p.command.match(/-DportOffset=(\d+)/);
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
  const expected = 9443 + offset;
  if (p.ports.includes(expected)) return expected;
  // Fallback for instances started without an explicit portOffset flag:
  // pick whichever listening port falls in the usual Carbon HTTPS range.
  return p.ports.find((port) => port >= 9443 && port <= 9543) ?? null;
}

function majorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

// From API-M 4.5 the portals ship in the separate API Control Plane distribution.
const PRODUCTS_WITH_PORTALS = ['API Manager', 'API Control Plane'];

/** Returns null for products that don't serve the API Manager portals. */
export function getPortalUrls(p: WSO2Process): PortalUrls | null {
  if (!PRODUCTS_WITH_PORTALS.includes(p.product)) return null;

  const port = resolveTransportPort(p);
  if (!port) return { admin: null, publisher: null, devportal: null };

  // Devportal was introduced in API-M 4.x as "/devportal"; older 3.x
  // releases called the same portal "/store". Admin portal is 4.x-only.
  const isV4Plus = majorVersion(p.version) >= 4;
  return {
    admin: isV4Plus ? `https://localhost:${port}/admin` : null,
    publisher: `https://localhost:${port}/publisher`,
    devportal: `https://localhost:${port}/${isV4Plus ? 'devportal' : 'store'}`,
  };
}
