import type { Command } from 'commander';
import { listJdks, useJdk, getActiveJdkPath } from '../lib/jvmManager.js';
import { printTable } from '../lib/format.js';

function register(program: Command): void {
  const jvm = program.command('jvm').description('Manage the global JVM version used by WSO2 products');

  jvm
    .command('list')
    .description('List installed JDKs on this machine')
    .action(() => {
      const jdks = listJdks();
      if (jdks.length === 0) {
        console.log('No JDKs found via /usr/libexec/java_home.');
        return;
      }
      const active = getActiveJdkPath();
      printTable(
        ['VERSION', 'ACTIVE', 'PATH'],
        jdks.map((j) => [j.version, j.path === active ? '*' : '', j.path])
      );
    });

  jvm
    .command('use <version>')
    .description('Switch the global JVM version (repoints ~/.wso2ctl/java)')
    .action((version: string) => {
      const resolved = useJdk(version);
      console.log(`Switched global JVM to ${version} -> ${resolved}`);
      console.log('New shells will pick this up automatically.');
      console.log('Already-open shells: re-source your shell profile or open a new terminal.');
      console.log('(One-time setup required: export JAVA_HOME="$HOME/.wso2ctl/java" — see README.)');
    });
}

export default { register };
