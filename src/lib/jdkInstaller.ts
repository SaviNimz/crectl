import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertMac } from './jvmManager.js';

const ADOPTIUM_API = 'https://api.adoptium.net/v3';

/**
 * macOS's `java_home` also scans this per-user folder, so a JDK unpacked
 * here is picked up by `wso2ctl jvm list` without needing sudo (unlike
 * /Library/Java/JavaVirtualMachines).
 */
export const USER_JVM_DIR = path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines');

export interface TemurinRelease {
  version: string;
  architecture: 'aarch64' | 'x64';
  fileName: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

interface AdoptiumAsset {
  version: { openjdk_version: string };
  binary: { package: { name: string; link: string; checksum: string; size: number } };
}

async function fetchLatestRelease(featureVersion: number, architecture: TemurinRelease['architecture']): Promise<TemurinRelease | null> {
  const url = `${ADOPTIUM_API}/assets/latest/${featureVersion}/hotspot?os=mac&architecture=${architecture}&image_type=jdk`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Adoptium API returned HTTP ${response.status} for ${url}`);

  const assets = (await response.json()) as AdoptiumAsset[];
  if (assets.length === 0) return null;

  const { version, binary } = assets[0];
  return {
    version: version.openjdk_version,
    architecture,
    fileName: binary.package.name,
    downloadUrl: binary.package.link,
    sha256: binary.package.checksum,
    sizeBytes: binary.package.size,
  };
}

function isRosettaInstalled(): boolean {
  return spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0;
}

/**
 * Finds the latest Eclipse Temurin build of a major Java version for this
 * Mac. Some old versions (notably Java 8) have no Apple Silicon build, so
 * on arm64 we fall back to the Intel build, which runs under Rosetta.
 */
export async function findTemurinRelease(featureVersion: number): Promise<TemurinRelease> {
  assertMac();
  const nativeArchitecture = process.arch === 'arm64' ? 'aarch64' : 'x64';

  const nativeRelease = await fetchLatestRelease(featureVersion, nativeArchitecture);
  if (nativeRelease) return nativeRelease;

  if (nativeArchitecture === 'aarch64') {
    const intelRelease = await fetchLatestRelease(featureVersion, 'x64');
    if (intelRelease) {
      if (!isRosettaInstalled()) {
        throw new Error(
          `Java ${featureVersion} has no Apple Silicon build, and the Intel build needs Rosetta.\n` +
            'Install it with: softwareupdate --install-rosetta --agree-to-license'
        );
      }
      return intelRelease;
    }
  }
  throw new Error(`Eclipse Temurin has no macOS build of Java ${featureVersion}.`);
}

/** Downloads a file while hashing it, reporting progress as a 0–100 percentage. */
async function downloadWithChecksum(url: string, destination: string, expectedBytes: number, onProgress: (percent: number) => void): Promise<string> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);

  const hash = createHash('sha256');
  let receivedBytes = 0;
  const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    receivedBytes += chunk.length;
    onProgress(Math.min(100, Math.floor((receivedBytes / expectedBytes) * 100)));
  });

  await pipeline(body, fs.createWriteStream(destination));
  return hash.digest('hex');
}

/** The JDK tarball unpacks to a single folder like `jdk-21.0.12.1+1/Contents/Home`. */
function findUnpackedBundle(extractDir: string): string {
  const bundleName = fs.readdirSync(extractDir).find((entry) => fs.existsSync(path.join(extractDir, entry, 'Contents', 'Home', 'bin', 'java')));
  if (!bundleName) throw new Error('The downloaded archive does not contain a macOS JDK bundle.');
  return path.join(extractDir, bundleName);
}

/**
 * Downloads, verifies and unpacks a Temurin JDK into ~/Library/Java/JavaVirtualMachines
 * as `temurin-<major>.jdk`, and returns its JAVA_HOME.
 */
export async function installTemurin(release: TemurinRelease, featureVersion: number, onProgress: (percent: number) => void): Promise<string> {
  const bundlePath = path.join(USER_JVM_DIR, `temurin-${featureVersion}.jdk`);
  if (fs.existsSync(bundlePath)) {
    throw new Error(`${bundlePath} already exists but java_home doesn't list it. Remove it and try again.`);
  }

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2ctl-jdk-'));
  // Unpack next to the final location so the last step is a same-volume rename.
  fs.mkdirSync(USER_JVM_DIR, { recursive: true });
  const extractDir = fs.mkdtempSync(path.join(USER_JVM_DIR, '.wso2ctl-unpack-'));

  try {
    const archivePath = path.join(downloadDir, release.fileName);
    const actualSha256 = await downloadWithChecksum(release.downloadUrl, archivePath, release.sizeBytes, onProgress);
    if (actualSha256 !== release.sha256) {
      throw new Error(`Checksum mismatch for ${release.fileName} (expected ${release.sha256}, got ${actualSha256}). Not installing.`);
    }

    const untar = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], { encoding: 'utf8' });
    if (untar.status !== 0) throw new Error(`Could not unpack ${release.fileName}: ${untar.stderr.trim()}`);

    fs.renameSync(findUnpackedBundle(extractDir), bundlePath);
    return path.join(bundlePath, 'Contents', 'Home');
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}
