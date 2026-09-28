# wso2ctl

A CLI tool for testing and controlling the WSO2 products running on your machine. This is built for **CRE engineers doing local debugging**.
---

## Quick install

**Requirements:** Node.js 18+ and macOS.

```sh
git clone https://github.com/SaviNimz/wso2ctl.git
cd wso2ctl
npm install
npm run build
npm link
```

Verify with:

```sh
wso2ctl --version
wso2ctl list
```

**To update:** `git pull && npm install && npm run build`. The link picks up the new build automatically.

**To uninstall:** `npm unlink -g wso2-tools`.

### One-time setup for JDK switching (optional)

`wso2ctl jvm use` switches your JDK by repointing a symlink at `~/.wso2ctl/java`.
A CLI can't change your parent shell's environment, so point `JAVA_HOME` at that
symlink once in `~/.zshrc`:

```sh
export JAVA_HOME="$HOME/.wso2ctl/java"
export PATH="$JAVA_HOME/bin:$PATH"
```

Then run `source ~/.zshrc` or open a new terminal. Run `wso2ctl jvm use <version>` at
least once so the symlink exists.

---

## Commands

Run `wso2ctl <command> --help` at any time to see all flags.

### `wso2ctl status`

Lists every WSO2 product running natively on the machine.

```sh
wso2ctl status
wso2ctl status --json
wso2-status            # shortcut
```

| Column | Meaning |
|---|---|
| `PID` | Process ID. Pass it to `stop`, `jstack`, `jcmd`, etc. |
| `PRODUCT` / `VERSION` | Resolved from the `CARBON_HOME` folder name (e.g. `wso2am-4.2.0` → API Manager 4.2.0) |
| `UPTIME` | How long the instance has been up |
| `ADMIN` / `PUBLISHER` / `DEVPORTAL` | Portal URLs for API Manager, using the **actual** listening port, so `-DportOffset` is taken into account. 3.x packs show `/store` instead of `/devportal`, and no Admin portal. |
| `CARBON_HOME` | The pack directory, so you know exactly which extracted copy is running |

**Debugging use:** run this first on any repro. It shows which pack and which copy is
actually running, and gives you clickable portal URLs even when you've set offsets on
several instances. Use `--json` to pipe the output into `jq` or scripts.

Detection matches Carbon signatures such as `-Dcarbon.home=`, `wso2server.sh`,
`micro-integrator.sh`, and `streaming-integrator.sh`. Supported products include API Manager,
Identity Server (and IS-as-KM), EI, MI, SI, SP, ESB, DAS, and IoT Server.

### `wso2ctl stop <target>`

Stops a single product. `<target>` is either a **PID** or a **text match** against the
product name, version, or `CARBON_HOME` path.

```sh
wso2ctl stop 48213            # by PID
wso2ctl stop 4.2.0            # by version
wso2ctl stop "Identity"       # by product name
wso2ctl stop am --dry-run     # show what would stop, do nothing
wso2ctl stop am -y --force    # no prompt, immediate SIGKILL
```

| Flag | Effect |
|---|---|
| `-y, --yes` | Skip the confirmation prompt |
| `--force` | Send SIGKILL immediately instead of shutting down gracefully |
| `--dry-run` | Only show what would be stopped |
| `--timeout <s>` | Seconds to wait after SIGTERM before escalating to SIGKILL (default `15`) |

If more than one instance matches, you get an interactive picker. By default the
command sends SIGTERM, waits, and then sends SIGKILL if the process is still alive.

**Debugging use:** restart one pack after a config change (for example, editing
`deployment.toml`) without touching the others running alongside it.

### `wso2ctl stop-all`

Stops every running WSO2 product. It shows a table first and asks for confirmation.

```sh
wso2ctl stop-all
wso2ctl stop-all --dry-run
wso2ctl stop-all -y
wso2-stop-all          # shortcut
```

Takes the same flags as `stop`: `-y`, `--force`, `--dry-run`, and `--timeout`.

**Debugging use:** get to a clean state between repros, and clear out leftover instances
that are still holding ports and causing `Address already in use` on the next startup.

### `wso2ctl jvm list` / `wso2ctl jvm use <version>` (macOS)

Lists installed JDKs and switches the global one.

```sh
wso2ctl jvm list       # '*' marks the active JDK
wso2ctl jvm use 11
wso2ctl jvm use 17
```

The command uses `/usr/libexec/java_home` to find JDKs. See the
[one-time setup](#one-time-setup-for-jdk-switching-optional) above.

**Debugging use:** customers run many different product and JDK combinations
(e.g. APIM 3.2.0 on JDK 8/11, APIM 4.x on JDK 11/17/21). Matching the customer's JDK is often
the difference between reproducing the issue and not. New terminals pick up the
switch immediately.

### `wso2ctl containers`

Lists Docker containers whose image or name contains `wso2`.

```sh
wso2ctl containers
wso2ctl containers --all     # include stopped containers
wso2ctl containers --json
```

**Debugging use:** see the Docker-based parts of a setup (such as a Docker Compose
deployment, or a DB/KM running in a container) next to your native packs, including
their port mappings. If Docker isn't running, the command skips the check instead of failing.

### `wso2ctl usage`

Shows CPU and memory for every WSO2 product, both native processes and containers, in one table.

```sh
wso2ctl usage              # sorted by CPU
wso2ctl usage --sort mem   # sorted by memory
wso2ctl usage --json
```

**Debugging use:** quickly spot the pack that's spinning a CPU or slowly using up
memory before you take a thread dump or heap dump. Get the PID here, then run
`jstack <pid>` or `jcmd <pid> GC.heap_dump`.

### `wso2ctl list`

Prints every available command, including any new ones you add, with a one-line description.

```sh
wso2ctl list
```

---

## Typical debugging session

```sh
wso2ctl stop-all -y            # clean slate
wso2ctl jvm use 11             # match the customer's JDK
# start the pack(s) you need
wso2ctl status                 # confirm what's up + grab portal URLs
wso2ctl usage --sort mem       # watch resource usage while reproducing
wso2ctl stop 4.2.0             # restart just one pack after a config change
```

---

## Adding a new command

The CLI is built to be extended. To add a command:

1. Create `src/commands/<name>.ts` exporting `{ register(program) }`. Copy any
   existing command to see the shape.
2. Add it to the array in `src/commands/index.ts`.
3. Run `npm run build`.

You don't need to change any other file. `wso2ctl list` shows the new command automatically.

Use `npm run dev` to rebuild automatically while you work.
