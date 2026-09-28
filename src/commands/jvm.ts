import type { Command } from 'commander';
import prompts from 'prompts';
import {
  assertMac,
  findInstalledJdk,
  switchToJdk,
  getActiveJdkPath,
  isShellUsingWso2ctlJava,
  isMajorVersionOnly,
  JAVA_SYMLINK,
} from '../lib/jvmManager.js';
import { listJdks, getMacOsDefaultJdk, parseFeatureVersion, compareJavaVersions } from '../lib/jdkDiscovery.js';
import { findTemurinRelease, installTemurin, USER_JVM_DIR, type TemurinRelease } from '../lib/jdkInstaller.js';
import { formatBytes, printTable } from '../lib/format.js';

/** Prints download progress in place on a terminal, or in 25% steps when output is piped. */
function createProgressReporter(): { update: (percent: number) => void; finish: () => void } {
  let lastReported = -1;
  const reporter = {
    update(percent: number) {
      if (process.stdout.isTTY) {
        if (percent !== lastReported) process.stdout.write(`\r  Downloading... ${percent}%`);
      } else if (percent >= lastReported + 25 || percent === 100) {
        console.log(`  Downloading... ${percent}%`);
      } else {
        return;
      }
      lastReported = percent;
    },
    finish() {
      if (lastReported < 100) reporter.update(100);
      if (process.stdout.isTTY) process.stdout.write('\n');
    },
  };
  return reporter;
}

/**
 * macOS uses the newest registered JDK as its default (`/usr/bin/java`, and
 * `java_home` with no -v). Installing a JDK newer than every existing one
 * would silently change that default for everything else on the Mac, so we
 * ask first.
 */
async function confirmIfDefaultWouldChange(release: TemurinRelease, assumeYes: boolean): Promise<void> {
  const currentDefault = getMacOsDefaultJdk();
  const becomesNewDefault = currentDefault !== null && compareJavaVersions(release.version, currentDefault.version) > 0;
  if (!becomesNewDefault || assumeYes) return;

  console.log('');
  console.log(`Note: Temurin ${release.version} would be the newest JDK on this Mac, so it would also become`);
  console.log(`macOS's default Java (currently ${currentDefault.version}). That affects /usr/bin/java and anything`);
  console.log('that runs /usr/libexec/java_home without -v, not just wso2ctl.');
  if (!process.stdin.isTTY) {
    throw new Error('Nothing was installed. Re-run with --yes to install it anyway.');
  }
  const answer = await prompts({ type: 'confirm', name: 'install', message: 'Install it anyway?', initial: false });
  if (!answer.install) throw new Error('Cancelled — nothing was installed.');
}

/** Downloads Temurin for a major version that isn't installed yet, and returns its JAVA_HOME. */
async function installMissingJdk(requestedVersion: string, assumeYes: boolean): Promise<string> {
  if (!isMajorVersionOnly(requestedVersion)) {
    throw new Error(
      `JDK ${requestedVersion} is not installed. Auto-install only takes a major version — ` +
        `try "wso2ctl jvm use ${parseFeatureVersion(requestedVersion)}" to get the latest one.`
    );
  }
  const featureVersion = parseFeatureVersion(requestedVersion)!;

  console.log(`JDK ${featureVersion} is not installed. Looking up the latest Eclipse Temurin ${featureVersion}...`);
  const release = await findTemurinRelease(featureVersion);
  await confirmIfDefaultWouldChange(release, assumeYes);
  const runsUnderRosetta = process.arch === 'arm64' && release.architecture === 'x64';
  console.log(
    `Installing Temurin ${release.version} (${release.architecture}${runsUnderRosetta ? ', runs under Rosetta' : ''}, ` +
      `${formatBytes(release.sizeBytes)}) into ${USER_JVM_DIR}`
  );

  const progress = createProgressReporter();
  try {
    const jdkHome = await installTemurin(release, featureVersion, progress.update);
    progress.finish();
    console.log('  Checksum verified, installed.');
    return jdkHome;
  } catch (err) {
    if (process.stdout.isTTY) process.stdout.write('\n');
    throw err;
  }
}

function printShellSetupStatus(): void {
  if (isShellUsingWso2ctlJava()) {
    // JAVA_HOME points at the symlink, so every such shell — already-open ones included — sees the new JDK at once.
    console.log('Active immediately in every terminal that uses wso2ctl\'s JAVA_HOME, including ones already open.');
    return;
  }
  console.log('');
  console.log(`⚠ This shell's JAVA_HOME is ${process.env.JAVA_HOME ?? '(unset)'}, not ${JAVA_SYMLINK},`);
  console.log('  so the switch has no effect in it yet. One-time setup: add these lines at the END of your');
  console.log('  shell profile (e.g. ~/.zshrc), after any other JAVA_HOME lines, then open a new terminal:');
  console.log('');
  console.log('    export JAVA_HOME="$HOME/.wso2ctl/java"');
  console.log('    export PATH="$JAVA_HOME/bin:$PATH"');
}

function reportFailure(err: unknown): void {
  console.error((err as Error).message);
  process.exitCode = 1;
}

function register(program: Command): void {
  const jvm = program.command('jvm').description('Manage the global JVM version used by WSO2 products');

  jvm
    .command('list')
    .description('List installed JDKs (macOS-registered, SDKMAN, asdf, mise, jenv, Homebrew)')
    .action(() => {
      try {
        assertMac();
        const jdks = listJdks();
        if (jdks.length === 0) {
          console.log('No JDKs found. "wso2ctl jvm use <version>" downloads one.');
          return;
        }
        const activeJdkPath = getActiveJdkPath();
        printTable(
          ['VERSION', 'ACTIVE', 'ARCH', 'SOURCE', 'PATH'],
          jdks.map((jdk) => [jdk.version, jdk.path === activeJdkPath ? '*' : '', jdk.architecture, jdk.source, jdk.path])
        );
      } catch (err) {
        reportFailure(err);
      }
    });

  jvm
    .command('use <version>')
    .description('Switch the global JVM version, downloading it first if it is not installed')
    .option('--no-install', "fail instead of downloading a JDK that isn't installed")
    .option('-y, --yes', "install without asking, even if the new JDK would become macOS's default Java")
    .addHelpText('after', '\n<version> is a major version (8, 1.8, 11, 17, 21) or an exact installed version (17.0.20).')
    .action(async (version: string, opts) => {
      try {
        assertMac();
        if (parseFeatureVersion(version) === null) {
          throw new Error(`"${version}" is not a Java version. Examples: 8, 11, 17, 21, 17.0.20.`);
        }

        const installedJdk = findInstalledJdk(version, listJdks());
        let jdkHome = installedJdk?.path;
        if (!jdkHome) {
          if (!opts.install) {
            throw new Error(`JDK ${version} is not installed. Run "wso2ctl jvm list" to see what is, or drop --no-install to download it.`);
          }
          jdkHome = await installMissingJdk(version, Boolean(opts.yes));
        }

        switchToJdk(jdkHome);
        const foundVia = installedJdk ? ` (already installed, via ${installedJdk.source})` : '';
        console.log(`Switched global JVM to ${installedJdk?.version ?? version}${foundVia} -> ${jdkHome}`);
        printShellSetupStatus();
      } catch (err) {
        reportFailure(err);
      }
    });
}

export default { register };
