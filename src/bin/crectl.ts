#!/usr/bin/env node
import { Command } from 'commander';
import { commands } from '../commands/index.js';

const VERSION = '0.1.0';

const program = new Command();
program
  .name('crectl')
  .description('CLI toolkit for managing local WSO2 product instances')
  .version(VERSION);

for (const cmd of commands) {
  cmd.register(program);
}

await program.parseAsync(process.argv);
