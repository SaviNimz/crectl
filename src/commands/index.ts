import status from './status.js';
import stop from './stop.js';
import stopAll from './stopAll.js';
import jvm from './jvm.js';
import containers from './containers.js';
import usage from './usage.js';
import list from './list.js';

// Adding a new command: create the file above and add it to this array.
// wso2ctl.ts never needs to change.
export const commands = [status, stop, stopAll, jvm, containers, usage, list];
