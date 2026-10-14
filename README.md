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

# Capture diagnostics while reproducing the issue
crectl dump 4.2.0 --jfr 60

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