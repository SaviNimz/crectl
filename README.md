# crectl

`crectl` is a command-line tool for managing and debugging WSO2 products running locally.

It is mainly intended for CRE engineers who need to run multiple WSO2 products, reproduce issues, inspect configurations, switch JDKs, check ports and resource usage, and collect diagnostic data.

## Installation

### Requirements

- macOS
- Node.js 18+

```bash
git clone https://github.com/SaviNimz/crectl.git
cd crectl

npm install
npm run build
npm link
```

Verify the installation:

```bash
crectl --version
crectl list
```

### Update

```bash
git pull
npm install
npm run build
```

### Uninstall

```bash
npm unlink -g crectl
```

---

## Commands

Run:

```bash
crectl <command> --help
```

to see the available options for any command.

| Command | Purpose |
|---|---|
| `crectl status` | Show running WSO2 products |
| `crectl inspect <target>` | Inspect a product installation or running instance |
| `crectl usage` | Show CPU and memory usage |
| `crectl ports` | Inspect ports and find free port offsets |
| `crectl stop <target>` | Stop a WSO2 product |
| `crectl stop-all` | Stop all running WSO2 products |
| `crectl dump <target>` | Capture thread dumps, heap dumps, or JFR recordings |
| `crectl log-level <target> [presets/loggers]` | Turn on debug logging without a restart, and undo it |
| `crectl update-diff <target>` | Show which jars a U2 update changed |
| `crectl jvm list` | List installed JDKs |
| `crectl jvm current` | Show the currently active JDK |
| `crectl jvm use <version>` | Switch to another JDK |
| `crectl containers` | Show WSO2 Docker containers |
| `crectl list` | List all available commands |

`<target>` can usually be a PID, product/version name, or another matching identifier.

---

## Status

Show all WSO2 products currently running on the machine:

```bash
crectl status
```

Example:

```bash
crectl status
crectl status --json
```

The output includes information such as:

- PID
- product and version
- uptime
- `CARBON_HOME`
- API Manager portal URLs
- effective ports and port offsets

This is usually the first command to run when debugging a local setup.

---

## Inspect a Product

`inspect` provides a summary of a WSO2 installation.

You can inspect either an extracted pack or a running instance:

```bash
crectl inspect ~/cases/wso2am-4.3.0
crectl inspect 4.3.0
crectl inspect 48213
```

It can show information including:

- product and version
- WSO2 update level
- JDK version and path
- JVM memory settings
- port offset
- `deployment.toml`
- databases and key managers
- gateway environments
- keystores and certificate expiry
- custom JARs and extensions

Sensitive datasource passwords are masked.

This is useful when checking whether a local reproduction environment matches another environment.

---

## CPU and Memory Usage

```bash
crectl usage
crectl usage --sort mem
```

Shows resource usage for WSO2 processes and containers.

Use it to quickly identify a process consuming high CPU or memory before collecting diagnostic data.

---

## Port Checking

Show the ports used by running WSO2 products:

```bash
crectl ports
```

Check whether a specific port offset is available:

```bash
crectl ports --offset 3
```

Find the lowest available offset:

```bash
crectl ports --suggest
```

Specify another product when required:

```bash
crectl ports --suggest --product mi
crectl ports --offset 5 --product is
```

Supported product identifiers include:

```text
am
acp
gw
tm
is
mi
```

This is useful when running multiple WSO2 products locally without manually checking for port conflicts.

---

## Stop Products

Stop a single product:

```bash
crectl stop 48213
crectl stop 4.2.0
crectl stop "Identity"
```

Preview what would be stopped:

```bash
crectl stop am --dry-run
```

Stop without confirmation:

```bash
crectl stop am -y
```

Force termination:

```bash
crectl stop am --force
```

Stop every running WSO2 product:

```bash
crectl stop-all
```

Useful options:

```text
-y, --yes       Skip confirmation
--force         Force termination
--dry-run       Show what would be stopped
--timeout <s>   Wait before forcing termination
```

---

## Diagnostic Dumps

`crectl dump` collects diagnostic information from a running WSO2 product.

### Thread dumps

By default, three thread dumps are captured five seconds apart:

```bash
crectl dump 4.3.0
```

Change the count and interval:

```bash
crectl dump 48213 --threads 5 --interval 10
```

### Heap dump

```bash
crectl dump am --heap
```

### Java Flight Recording

```bash
crectl dump am --jfr 60
```

### Heap dump only

```bash
crectl dump am --threads 0 --heap
```

Output is stored under:

```text
./crectl-dumps/<product>-pid<PID>-<timestamp>/
```

Depending on the options used, the directory can contain:

```text
process-info.txt
thread-dump-1.txt
thread-dump-2.txt
thread-dump-3.txt
heap-dump.hprof
recording.jfr
```

`crectl` uses tools from the same JDK as the running server where possible, avoiding common JDK mismatch issues when attaching diagnostic tools.

---

## Debug Logging

`crectl log-level` turns on debug logging for common scenarios without you having to look up
package names, and without a restart. A running server picks up the change within a few seconds.

```bash
crectl log-level am wire                      # wire logs on the running API Manager
crectl log-level is oauth saml                # several presets at once
crectl log-level 48213 org.foo.Bar --level TRACE
crectl log-level ./wso2mi-4.4.0 synapse       # a pack that isn't running (applies on next start)
crectl log-level am                           # show the active overrides
crectl log-level am wire --reset              # turn one preset off again
crectl log-level am --reset                   # back to the pack's own levels
```

| Preset | Loggers it turns on |
|---|---|
| `wire` | HTTP wire logs: raw headers and payloads through the gateway (APIM, MI) |
| `passthru` | Pass-through HTTP transport: connections, timeouts, socket errors |
| `synapse` | Mediation engine: sequences, mediators, endpoints (noisy) |
| `gateway-auth` | Gateway OAuth, JWT and API key validation |
| `throttling` | Gateway throttling decisions |
| `keymanager` | Key manager calls: token validation, key generation, KM client |
| `oauth` | OAuth2 / OIDC token issuance and validation (IS, APIM) |
| `saml` | SAML SSO, as IdP and as federated authenticator |
| `authn` | Authentication framework: login flows, steps, federated IdPs |
| `userstore` | JDBC / LDAP / AD user store lookups |
| `scim` | SCIM 2.0 user and group provisioning |

Run `crectl log-level --help` for the full list. `<target>` is a PID, a name match, or a pack directory.

**How it changes the pack:** `crectl` appends a marked block to `log4j2.properties` and never edits the
pack's own lines. A logger the pack already declares is re-levelled in place, because the later line wins
in a properties file; new loggers are added to the `loggers` list. `--reset` removes the block, leaving the
file byte-for-byte as it was. Remember to reset before handing a pack back or zipping it up for a case.

---

## Jars Changed by a U2 Update

`crectl update-diff` (alias `u2-diff`) shows which jars and wars a U2 update changed. Before applying
updates, the update tool (`bin/wso2update_<os>`) backs the whole pack up to `~/.wso2-updates/backup/` and
records where in `updates/config.json`. This command compares the pack against that backup, so it only
works on a pack that has been updated in place.

```bash
crectl update-diff ./wso2am-4.5.0
crectl update-diff am --only upgraded,added      # just these change types
crectl update-diff am --filter apimgt            # jars whose folder or name contains "apimgt"
crectl update-diff am --backup ~/.wso2-updates/backup/wso2am-4.5.0-<id>   # an older backup, to span several runs
crectl update-diff am --json
```

```text
API Manager 4.5.0: update level 57 -> 83
  Pack       /Users/me/work/wso2am-4.5.0
  Backup     ~/.wso2-updates/backup/wso2am-4.5.0-c363d5ac-... (taken 10/13/2026, 4:34:25 PM)
  Changelog  updates/changelog-0057-0083.md

140 of 971 jars/wars changed: 130 upgraded, 8 modified, 2 added

repository/components/plugins/  (102)
  CHANGE    JAR / WAR                    BEFORE           AFTER            SIZE
  upgraded  org.wso2.carbon.apimgt.impl  9.31.86.158      9.31.86.225      +89.5 KB
  upgraded  httpcore-nio                 4.4.16.wso2v4    4.4.16.wso2v4_1  +45 B
  ...
```

| Change | Meaning |
|---|---|
| `upgraded` | The jar was replaced by a new version (matched by name within the same folder) |
| `modified` | Same file name, different content (compared by SHA-256) |
| `added` / `removed` | Only in the updated pack / only in the backup |

Runtime copies are left out: the OSGi bundle cache, `tmp/`, logs, webapp folders unpacked from a `.war`
(the `.war` itself is compared), and the `dropins/*_1.0.0.jar` bundles Carbon regenerates from `lib/`
on every start.

A pack unzipped from an already-updated download (e.g. `wso2is-7.2.0.26.zip`) has an update level but no
backup. Run the update tool on it, or point `--backup` at another pack of the same product.

---

## JDK Management

### List installed JDKs

```bash
crectl jvm list
```

### Check the current JDK

```bash
crectl jvm current
```

### Switch JDK

```bash
crectl jvm use 11
crectl jvm use 17
crectl jvm use 21
```

An exact installed version can also be selected:

```bash
crectl jvm use 17.0.20
```

If the requested major version is not installed, `crectl` can download an Eclipse Temurin JDK automatically.

To prevent automatic installation:

```bash
crectl jvm use 11 --no-install
```

### One-time shell setup

JDK switching works through:

```text
~/.crectl/java
```

To make your shell follow the JDK selected by `crectl`, add the following to the **end** of your shell profile, such as `~/.zshrc`:

```bash
export JAVA_HOME="$HOME/.crectl/java"
export PATH="$JAVA_HOME/bin:$PATH"
```

Before reloading the shell, select the JDK you currently use:

```bash
crectl jvm use <version>
```

For example:

```bash
crectl jvm use 17
```

A WSO2 server that is already running continues using the JDK it started with. Restart the server after switching JDKs.

---

## Docker Containers

Show running WSO2 containers:

```bash
crectl containers
```

Include stopped containers:

```bash
crectl containers --all
```

Machine-readable output:

```bash
crectl containers --json
```

If Docker is not running, the command skips the Docker check rather than failing.

---

## Typical Debugging Workflow

A common local reproduction workflow looks like this:

```bash
# Check the product setup
crectl inspect ./wso2am-4.2.0

# Stop old instances
crectl stop-all -y

# Match the required Java version
crectl jvm use 11

# Find a free port offset
crectl ports --suggest

# Start the required WSO2 product

# Confirm the running instance
crectl status

# Monitor CPU and memory
crectl usage --sort mem

# Turn on the relevant debug logs (no restart needed)
crectl log-level 4.2.0 wire gateway-auth

# Capture diagnostics while reproducing the issue
crectl dump 4.2.0 --jfr 60

# Put the log levels back
crectl log-level 4.2.0 --reset

# Stop or restart the product when needed
crectl stop 4.2.0
```

---

## JSON Output

Several commands support `--json` for scripting and automation:

```bash
crectl status --json
crectl inspect 48213 --json
crectl usage --json
crectl containers --json
crectl log-level am --json
crectl update-diff am --json
```

For example:

```bash
crectl status --json | jq
```

---

## Development

Commands are located under:

```text
src/commands/
```

To add a command:

1. Create `src/commands/<name>.ts`.
2. Export a `register(program)` function.
3. Register the command in `src/commands/index.ts`.
4. Build the project.

```bash
npm run build
```

During development:

```bash
npm run dev
```

Use:

```bash
crectl list
```

to confirm that the new command has been registered.