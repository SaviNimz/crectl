const PRODUCT_PREFIX_MAP: Record<string, string> = {
  wso2am: 'API Manager',
  'wso2am-analytics': 'API Manager Analytics',
  'wso2am-acp': 'API Control Plane',
  'wso2am-universal-gw': 'Universal Gateway',
  'wso2am-tm': 'Traffic Manager',
  wso2is: 'Identity Server',
  'wso2is-km': 'Identity Server KM',
  wso2ei: 'Enterprise Integrator',
  wso2mi: 'Micro Integrator',
  wso2si: 'Streaming Integrator',
  wso2sp: 'Stream Processor',
  wso2esb: 'Enterprise Service Bus',
  wso2das: 'Data Analytics Server',
  wso2ml: 'Machine Learner',
  wso2iot: 'IoT Server',
};

const KNOWN_PREFIXES = Object.keys(PRODUCT_PREFIX_MAP).sort((a, b) => b.length - a.length);

/**
 * Splits a carbon.home folder name like "wso2am-4.2.0" into a friendly
 * product name and version. Known prefixes are matched first (checked
 * longest-first, e.g. "wso2am-analytics" before "wso2am") so a folder
 * like "wso2am-4.5.0-1" (a duplicated instance dir, not a real version)
 * still resolves to "API Manager" / "4.5.0-1" instead of misreading the
 * trailing "-1" as a whole separate version segment. Anything not in the
 * lookup table falls back to a generic "<prefix>-<version>" split.
 */
export function resolveProduct(folderName: string): { product: string; version: string } {
  const lower = folderName.toLowerCase();
  for (const prefix of KNOWN_PREFIXES) {
    if (lower === prefix) return { product: PRODUCT_PREFIX_MAP[prefix], version: '' };
    if (lower.startsWith(`${prefix}-`)) {
      return { product: PRODUCT_PREFIX_MAP[prefix], version: folderName.slice(prefix.length + 1) };
    }
  }

  const match = folderName.match(/^(.*?)-(\d[\w.]*)$/);
  if (!match) {
    return { product: folderName, version: '' };
  }
  const [, prefix, version] = match;
  return { product: prefix, version };
}
