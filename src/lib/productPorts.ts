export interface PortDefinition {
  /** Port number before any offset is applied. */
  basePort: number;
  purpose: string;
}

export interface PortProfile {
  /** Offset applied when none is configured (Micro Integrator ships with 10). */
  defaultOffset: number;
  ports: PortDefinition[];
}

const MANAGEMENT_PORTS: PortDefinition[] = [
  { basePort: 9443, purpose: 'Management HTTPS (portals, admin services)' },
  { basePort: 9763, purpose: 'Management HTTP' },
];

const GATEWAY_PORTS: PortDefinition[] = [
  { basePort: 8243, purpose: 'Gateway HTTPS (API traffic)' },
  { basePort: 8280, purpose: 'Gateway HTTP (API traffic)' },
  { basePort: 9099, purpose: 'Gateway WebSocket' },
  { basePort: 8099, purpose: 'Gateway WebSocket secure' },
];

const WEBSUB_PORTS: PortDefinition[] = [
  { basePort: 9021, purpose: 'WebSub event receiver HTTP' },
  { basePort: 8021, purpose: 'WebSub event receiver HTTPS' },
];

const EVENT_HUB_PORTS: PortDefinition[] = [
  { basePort: 9611, purpose: 'Binary / Thrift event receiver' },
  { basePort: 9711, purpose: 'Binary / Thrift event receiver SSL' },
  { basePort: 5672, purpose: 'JMS (AMQP)' },
  { basePort: 8672, purpose: 'JMS (AMQP SSL)' },
];

const JMX_PORTS: PortDefinition[] = [
  { basePort: 11111, purpose: 'JMX RMI registry' },
  { basePort: 9999, purpose: 'JMX RMI server' },
];

const MICRO_INTEGRATOR_PORTS: PortDefinition[] = [
  { basePort: 8280, purpose: 'HTTP passthrough (API/proxy traffic)' },
  { basePort: 8243, purpose: 'HTTPS passthrough (API/proxy traffic)' },
  { basePort: 9154, purpose: 'Management API' },
  { basePort: 9191, purpose: 'Internal APIs HTTP' },
  { basePort: 9176, purpose: 'Internal APIs HTTPS' },
];

/** Short names accepted by `--product`, mapped to the display names used everywhere else. */
export const PRODUCT_ALIASES: Record<string, string> = {
  am: 'API Manager',
  acp: 'API Control Plane',
  gw: 'Universal Gateway',
  tm: 'Traffic Manager',
  is: 'Identity Server',
  mi: 'Micro Integrator',
};

function majorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** The ports a product binds by default. Unknown products fall back to the common Carbon ports. */
export function getPortProfile(product: string, version = ''): PortProfile {
  switch (product) {
    case 'API Manager': {
      // WebSub receivers were added in API-M 4.0.
      const websub = version && majorVersion(version) < 4 ? [] : WEBSUB_PORTS;
      return { defaultOffset: 0, ports: [...MANAGEMENT_PORTS, ...GATEWAY_PORTS, ...websub, ...EVENT_HUB_PORTS, ...JMX_PORTS] };
    }
    case 'API Control Plane':
    case 'Traffic Manager':
      return { defaultOffset: 0, ports: [...MANAGEMENT_PORTS, ...EVENT_HUB_PORTS, ...JMX_PORTS] };
    case 'Universal Gateway':
      return { defaultOffset: 0, ports: [...MANAGEMENT_PORTS, ...GATEWAY_PORTS, ...WEBSUB_PORTS, ...JMX_PORTS] };
    case 'Micro Integrator':
      return { defaultOffset: 10, ports: MICRO_INTEGRATOR_PORTS };
    default:
      return { defaultOffset: 0, ports: [...MANAGEMENT_PORTS, ...JMX_PORTS] };
  }
}
