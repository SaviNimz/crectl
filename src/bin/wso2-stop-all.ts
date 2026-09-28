#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'wso2ctl.js');

const result = spawnSync(process.execPath, [target, 'stop-all', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 0);
