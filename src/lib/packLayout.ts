import fs from 'node:fs';
import path from 'node:path';

/**
 * Where things live inside an extracted WSO2 pack. Carbon-based products
 * (API Manager, Identity Server, ...) keep everything under `repository/`,
 * while Micro Integrator 4.x moved `conf/`, `lib/`, `dropins/` and
 * `patches/` up to the pack root.
 */
export interface PackLayout {
  deploymentToml: string;
  securityDir: string;
  libDir: string;
  dropinsDir: string;
  patchesDir: string;
  updatesDir: string;
}

export function getPackLayout(carbonHome: string): PackLayout {
  const carbonStyleToml = path.join(carbonHome, 'repository', 'conf', 'deployment.toml');
  const usesRootLayout = !fs.existsSync(carbonStyleToml) && fs.existsSync(path.join(carbonHome, 'conf', 'deployment.toml'));
  const extensionsRoot = usesRootLayout ? carbonHome : path.join(carbonHome, 'repository', 'components');

  return {
    deploymentToml: usesRootLayout ? path.join(carbonHome, 'conf', 'deployment.toml') : carbonStyleToml,
    securityDir: path.join(carbonHome, 'repository', 'resources', 'security'),
    libDir: path.join(extensionsRoot, 'lib'),
    dropinsDir: path.join(extensionsRoot, 'dropins'),
    patchesDir: path.join(extensionsRoot, 'patches'),
    updatesDir: path.join(carbonHome, 'updates'),
  };
}

/** A directory looks like a WSO2 pack if it has a `bin/` folder and a deployment.toml. */
export function isWso2PackDirectory(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'bin')) && fs.existsSync(getPackLayout(dir).deploymentToml);
}
