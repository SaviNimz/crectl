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
symlink once. Add these lines to your shell profile (`~/.zshrc` by default on macOS):

```sh
export JAVA_HOME="$HOME/.wso2ctl/java"
export PATH="$JAVA_HOME/bin:$PATH"
```

Put them at the **end** of the file. If the profile already sets `JAVA_HOME` (for example
with `/usr/libexec/java_home`, SDKMAN, or jenv), a later line wins, so wso2ctl's lines need to
come last.

Before opening a new terminal, run `wso2ctl jvm use <version>` with the JDK you use today, so
the symlink exists and nothing changes for you. `jvm use` warns you if the shell you ran it
from isn't set up this way.

This is opt-in. Until you add these lines, `wso2ctl jvm` doesn't affect your shell at all.

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

A product is detected by the `-Dcarbon.home=` flag its startup script passes to the JVM, so
the `sh wso2server.sh` launcher shell in front of it isn't listed. Supported products include API Manager,
Identity Server (and IS-as-KM), the API-M 4.5+ distributions (API Control Plane, Universal
Gateway, Traffic Manager), EI, MI, SI, SP, ESB, DAS, and IoT Server.

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

Lists installed JDKs and switches the global one. **If the JDK you ask for isn't
installed, `jvm use` downloads it for you.**

```sh
wso2ctl jvm list              # '*' marks the active JDK
wso2ctl jvm use 11            # newest installed JDK 11; downloads Temurin 11 if there is none
wso2ctl jvm use 8             # "8" and "1.8" both mean Java 8
wso2ctl jvm use 17.0.20       # an exact installed version
wso2ctl jvm use 21 --no-install   # fail instead of downloading
```

How it works:

1. **Use what's already installed.** It looks for JDKs everywhere they're commonly
   installed on a Mac:
   - JDKs registered with macOS (`/usr/libexec/java_home -V`): installers, `brew install --cask`, IntelliJ downloads
   - SDKMAN (`~/.sdkman/candidates/java`)
   - asdf (`~/.asdf/installs/java`)
   - mise (`~/.local/share/mise/installs/java`)
   - jenv (`~/.jenv/versions`)
   - Homebrew formulae (`openjdk`, `openjdk@17`, …), including ones not linked into `/Library/Java`

   It picks the newest JDK with the **same major version**, preferring one built for your
   Mac's CPU. (It doesn't use `java_home -v 11`, which treats the version as a minimum and
   returns a newer JDK when 11 isn't installed.) `jvm list` shows where each JDK was found.
2. **Install only if it's missing.** It downloads the latest
   [Eclipse Temurin](https://adoptium.net) build of that major version from the Adoptium API,
   **verifies its SHA-256 checksum**, and unpacks it to
   `~/Library/Java/JavaVirtualMachines/temurin-<major>.jdk`. That's a per-user folder macOS
   already scans, so **no sudo is needed**, and your IDE and other tools see it like any other
   JDK. On Apple Silicon, Java 8 (which has no ARM build) is installed as the Intel build and
   runs under Rosetta.
3. **Switch.** It repoints `~/.wso2ctl/java` at the chosen JDK. Because `JAVA_HOME` points at
   that symlink, every terminal set up as described in the
   [one-time setup](#one-time-setup-for-jdk-switching-optional) switches at once, including
   terminals that are already open.

**What it never touches:** existing JDKs, `/Library/Java`, your shell profile, or other
version managers' settings. It only writes the `~/.wso2ctl/java` symlink and, when a JDK is
missing, a new `temurin-<major>.jdk` folder (it refuses to overwrite one that already exists).

**macOS's default Java is protected.** macOS treats the newest registered JDK as the system
default (`/usr/bin/java`, and `java_home` with no `-v`). If the JDK being downloaded would be
newer than every JDK you have, and so would change that default, `jvm use` asks before installing.
When input isn't interactive it stops unless you pass `--yes`.

| Flag | Effect |
|---|---|
| `--no-install` | Never download. Fail if the JDK isn't installed. |
| `-y, --yes` | Install without asking, even if the new JDK would become macOS's default |

To remove a JDK that wso2ctl installed: `rm -rf ~/Library/Java/JavaVirtualMachines/temurin-<major>.jdk`.

A server that's already running keeps the JDK it started with. Restart it to pick up the
switch, then check it with `wso2ctl inspect <target>`.

**Debugging use:** customers run many different product and JDK combinations
(e.g. APIM 3.2.0 on JDK 8/11, APIM 4.x on JDK 11/17/21). Matching the customer's JDK is often
the difference between reproducing the issue and not. With auto-install, matching it is one command,
even on a fresh laptop.

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

### `wso2ctl ports`

Shows which ports each running product uses, and checks whether an offset is free
*before* you start another pack.

```sh
wso2ctl ports                          # ports of every running product
wso2ctl ports --offset 3               # are API Manager's ports free at offset 3?
wso2ctl ports --offset 12 --product mi # same check for Micro Integrator
wso2ctl ports --suggest                # lowest free offset for API Manager
wso2ctl ports --suggest --product is   # ... for Identity Server
```

| Flag | Effect |
|---|---|
| `--offset <n>` | Check every port the product would bind at this offset. Exits `1` if any are taken. |
| `--suggest` | Find the lowest offset where all the product's ports are free, and print the config to use |
| `--product <name>` | Product to check with `--offset`/`--suggest`: `am` (default), `acp`, `gw`, `tm`, `is`, `mi` |
| `--json` | Machine-readable output |

With no flags, each running instance is listed with its offset and where the offset came from
(a `-DportOffset` flag, `[server] offset` in `deployment.toml`, or the product default). Each
expected port is shown as `listening` or `NOT LISTENING`, next to what it's for (management
HTTPS, gateway HTTP/S, WebSocket, WebSub, Thrift, JMS, JMX, and so on). Ports that aren't standard
WSO2 ports, such as a remote debug agent, are listed separately.

With `--offset`, any port that's taken shows **who holds it** (PID and process name). That
includes system services and other users' processes, which `lsof` can't see without sudo.

**Debugging use:** stop guessing offsets. Before starting a second or third pack for a repro,
`--suggest` gives you an offset that works first time, so you don't get a half-started server
with `Address already in use` buried in the log. When a server starts but something doesn't
respond, `wso2ctl ports` shows which listener never came up.

> Micro Integrator has a built-in offset of 10 (HTTP 8290, Management API 9164), so its offsets
> start at 10.

### `wso2ctl dump <target>`

Captures thread dumps, a heap dump, and/or a Java Flight Recording from a running product,
all in one timestamped folder. `<target>` works like `stop`: a PID or a name match.

```sh
wso2ctl dump 4.3.0                        # 3 thread dumps, 5s apart (the usual support ask)
wso2ctl dump 48213 --threads 5 --interval 10
wso2ctl dump am --heap                    # thread dumps + heap dump
wso2ctl dump am --jfr 60                  # thread dumps while a 60s JFR recording runs
wso2ctl dump am --threads 0 --heap        # heap dump only
```

| Flag | Effect |
|---|---|
| `--threads <count>` | Number of thread dumps (default `3`; `0` to skip) |
| `--interval <s>` | Seconds between thread dumps (default `5`) |
| `--heap` | Also take a heap dump (`.hprof`). The JVM pauses while it's written, and the file is roughly the size of the used heap. |
| `--jfr <s>` | Also record a JFR for this many seconds. It starts first, so the thread dumps are taken while it records. |
| `--out <dir>` | Parent folder for the dumps (default `./wso2ctl-dumps`) |

Output goes to `<out>/<pack>-pid<PID>-<timestamp>/`:

```
process-info.txt     product, PID, CARBON_HOME, full JVM command line
thread-dump-1..N.txt jcmd Thread.print -l (includes lock info)
thread-cpu-1..N.txt  per-thread CPU from top -H (Linux only), to match against the nid in each dump
heap-dump.hprof      with --heap
recording.jfr        with --jfr (open in JDK Mission Control)
```

`jcmd` is taken from **the same JDK the server is running on**, so you won't get attach
errors from a mismatched JDK on your PATH.

**Debugging use:** when you reproduce a hang, a CPU spike, or a slow API, capture the same
evidence support asks customers for, with one command, before the moment passes. Pair it
with `wso2ctl usage` to find the busy pack first.

### `wso2ctl inspect <target>`

A one-screen summary of a pack's setup. `<target>` can be a **pack directory (running or
not)**, a PID, or a name match.

```sh
wso2ctl inspect ~/cases/my-case/wso2am-4.3.0     # any extracted pack
wso2ctl inspect 4.3.0                            # a running instance
wso2ctl inspect 48213 --json
```

| Section | What it shows |
|---|---|
| Product | Product, version, location, and the **update level** recorded by the WSO2 Updates 2.0 tool |
| Runtime | Running or not, PID, uptime, **JDK version and path**, `-Xms`/`-Xmx`. For a stopped pack, the JDK `JAVA_HOME` would start it with. |
| Ports | Effective port offset (and where it came from) and the primary port |
| Configuration | `deployment.toml` path, key manager (resident or external), datasources (type, user, JDBC URL with passwords masked), gateway environments |
| Keystores | Primary and TLS keystores and the truststore: entry count and **certificate expiry**, with a warning if the certificate has expired or expires within 30 days. Handles `.jks` and `.p12`, and passwords set via `$env{}`. Secure Vault (`$secret{}`) passwords are reported but not decrypted. |
| Extensions | Jars in `components/lib` and `dropins` (auto-generated OSGi bundles hidden), and WUM patches |

**Debugging use:** when you pick up a case or reuse an old repro pack, see immediately whether it
matches what the customer runs: the same update level, JDK, database type, and custom jars.
It also catches the classic "my local pack suddenly fails TLS" problem, because an expired
default `wso2carbon` certificate is flagged as `CERTIFICATE HAS EXPIRED`.

### `wso2ctl list`

Prints every available command, including any new ones you add, with a one-line description.

```sh
wso2ctl list
```

---

## Typical debugging session

```sh
wso2ctl inspect ./wso2am-4.2.0 # check update level, DBs, jars against the customer's setup
wso2ctl stop-all -y            # clean slate
wso2ctl jvm use 11             # match the customer's JDK
wso2ctl ports --suggest        # pick a clash-free offset for the next pack
# start the pack(s) you need
wso2ctl status                 # confirm what's up + grab portal URLs
wso2ctl usage --sort mem       # watch resource usage while reproducing
wso2ctl dump 4.2.0 --jfr 60    # capture evidence while the issue is happening
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
