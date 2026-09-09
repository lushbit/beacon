# Beacon

Beacon is a self-hosted dashboard for watching machines you own.

You run the hub on one machine. You install a small agent on every machine you
want to watch. The agents report in, and the dashboard shows you CPU, memory,
disks, network, temperatures, GPUs, batteries, processes and Docker containers,
live, with history and alerts.

Agents dial out to the hub rather than listening for connections. A laptop
behind a home router, a server behind a corporate firewall and a VPS in a data
centre all work the same way, with no port forwarding and nothing extra exposed
on the monitored machine.

```
  device --.
  device --+--- outbound WebSocket --->  hub  --->  browser
  device --'                          (SQLite)
```

Everything stays on your own infrastructure. There are no accounts to sign up
for, no telemetry and no third-party services. Beacon is free software under the
AGPL-3.0-or-later.

## Features

- **One command to add a device.** The dashboard generates it. The agent
  installs itself as a service and starts reporting.
- **Live values.** Readings arrive over a WebSocket as they happen, and fall
  back to polling where WebSockets are blocked.
- **History that stays small.** Recent data is kept at full resolution and
  averaged down as it ages, so a year of history is still a small file.
- **Alerts** on thresholds and on devices going offline, sent to ntfy, Discord
  or any webhook.
- **Remote screen viewing**, view-only, off by default, and audited.
- **Live process list**, with the option to end a process.
- **Agent updates from your own hub**, with automatic rollback if a new build
  fails to start.
- **Accounts and roles.** Admins can change things. Viewers can only look.

## Requirements

| | |
| --- | --- |
| Hub | Docker, or Node.js 20 or newer |
| Agent | Node.js 20 or newer, or Docker |
| Platforms | Linux, macOS, Windows |
| Architectures | x86-64 and arm64 |
| Port | `4800` by default |

The agent is plain JavaScript, so it runs anywhere Node runs and needs no
compiler on the device.

## Install the hub

### With Docker

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon/docker
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" > .env
docker compose up -d
```

Open `http://your-host:4800` and create the first administrator account. No
other page is reachable until that account exists.

`SESSION_SECRET` signs session cookies. Keep the `.env` file, because a new
value on every start signs everyone out. Compose reads the file itself, so
`sudo docker compose up -d` works. Passing the variable through `sudo` on the
command line does not work, because sudo clears the environment.

### From source

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon
npm install
./scripts/build-release.sh
cd release
SESSION_SECRET=$(openssl rand -hex 48) node server/dist/index.js
```

`scripts/build-release.sh` produces exactly what the Docker image ships. The
`release/` directory is self-contained and runs with
`node server/dist/index.js`.

## Behind a reverse proxy

Terminate TLS in front of the hub, point the proxy at `127.0.0.1:4800`, and set
`TRUST_PROXY=1` so that rate limiting sees real client addresses instead of the
proxy's.

Two paths must be forwarded as WebSockets. `/live` carries readings to the
browser, and `/agent` carries them from your devices. Without them the dashboard
drops back to polling every five seconds, and agents cannot connect at all.

Caddy handles both with no extra configuration:

```caddyfile
beacon.example.com {
	reverse_proxy 127.0.0.1:4800
}
```

nginx needs the upgrade headers spelled out:

```nginx
location / {
	proxy_pass http://127.0.0.1:4800;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $scheme;
	proxy_read_timeout 3600s;
}
```

## Add a device

Press **Add device** on the Overview page. Beacon issues an enrollment token,
which you can limit to a number of devices and give an expiry, and then shows
you the install command for each platform.

| Platform | Command |
| --- | --- |
| Linux, macOS | `curl -sSL https://hub/install.sh \| sh -s -- --url https://hub --token TOKEN` |
| Windows | `& ([scriptblock]::Create((irm https://hub/install.ps1))) -Url https://hub -Token TOKEN` |
| Docker | `docker build -t beacon-agent https://hub/download/beacon-agent-docker.tar.gz` |

The token is stored hashed and shown only once. On its first connection the
agent trades it for a key belonging to that device alone, so the token is not
worth keeping afterwards.

A few things differ per platform:

- **Linux** installs a user systemd unit. Run the command with `sudo` for a
  system-wide one that starts before anyone logs in.
- **macOS** installs a launchd agent for the current user.
- **Windows** runs the agent in your desktop session, which is what makes screen
  viewing possible. For a server nobody logs into, add `-SystemService` from an
  elevated prompt. It then starts with the machine, without screen capture.
- **Docker** builds from a context the hub serves, so the host needs neither git
  nor access to this repository. Run it with `--network host --pid host` and the
  Docker socket mounted read-only to see host and container metrics. Screen
  viewing is not possible from a container. The dashboard prints the full
  `docker run` line for you.
- **Using a self-signed certificate?** Turn on the toggle in the dialog. The
  commands then include the flags needed to skip verification, including for the
  download itself.

## Alerts

Every new device starts with rules for high CPU, high memory, a filling disk and
going offline. Edit those or write your own under **Alerts, Rules**. A rule can
apply to one device or to all of them, and carries a severity and a duration the
condition must hold before it fires, so a brief spike does not wake you up.

Choose where alerts go under **Settings, Notifications**:

| Channel | What you configure |
| --- | --- |
| ntfy | Server URL and topic, using the hosted `ntfy.sh` or your own |
| Discord | Webhook URL |
| Webhook | Any endpoint that accepts a JSON POST |

Each channel has a minimum severity and a test button.

## Configuration

Most things can be left alone. These are the knobs that exist.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | none | **Required in production.** Signs session cookies |
| `PORT` | `4800` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `DATABASE_PATH` | `data/beacon.db` | SQLite file, absolute or relative to the server package |
| `TRUST_PROXY` | `0` | Set to `1` when a reverse proxy terminates TLS |
| `PUBLIC_DIR` | `../public` | Where installers and agent bundles are served from |
| `BEACON_UPDATE_REPO` | this repository | Release feed the update check reads |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` |
| `LOGIN_WINDOW_SEC` | `900` | Login throttling window |
| `LOGIN_PAIR_LIMIT` | `20` | Failures per address and username before refusal |
| `LOGIN_IP_LIMIT` | `100` | Failures per address across all usernames |
| `LOGIN_MAX_DELAY_MS` | `8000` | Ceiling on the delay added to a wrong password |

### Server settings

These live in the database and are edited under **Settings, Server**.

| Setting | Default |
| --- | --- |
| Raw retention | 48 hours |
| One-minute retention | 30 days |
| One-hour retention | 365 days |
| Default sample interval | 5 seconds |
| Offline after | 30 seconds without a sample |
| Session lifetime | 720 hours |
| Update checks | on |
| Agent update policy | manual, with an optional nightly window |

Sample interval, offline threshold, which disks and interfaces are shown,
process control and screen capture can all be overridden per device.

### Agent

```
--url <hub>        --token <token>     --config <path>
--insecure-tls     --uninstall         --version   --help
```

The agent keeps its configuration beside itself in `agent.json`, or at
`/data/agent.json` under Docker. It holds the hub URL and the device key.

## Backups

Everything is in one SQLite database: metrics, devices, users, alerts and the
audit log. Under Docker it is `/data/beacon.db` on the `beacon-data` volume.

The database runs in WAL mode, so copying the file while the hub is running can
give you an inconsistent snapshot. Take a proper one without stopping anything:

```bash
docker compose exec beacon \
  node -e "require('better-sqlite3')('/data/beacon.db').backup('/data/backup.db').then(()=>process.exit(0))"
docker compose cp beacon:/data/backup.db ./beacon-backup.db
```

To restore, stop the hub, put the file back as `beacon.db`, delete any stale
`beacon.db-wal` and `beacon.db-shm` sitting beside it, and start the hub again.

## Updating

### The hub

The hub checks for new versions at startup, every six hours and when you sign
in. When one exists it links the release notes in the sidebar.

```bash
cd beacon && git pull
cd docker && docker compose up -d --build
```

Your data is on a volume and a rebuild does not touch it. Database migrations
run automatically at startup.

### The agents

Agents update from your hub, never from the internet. Press **Update** on a
device, or **Update all agents** under **Settings, About**, or set a policy with
a nightly window and let it happen on its own.

If a new build fails to start twice, the agent rolls itself back to the previous
version. A broken update cannot leave a machine unmonitored.

## Uninstall

Remove an agent from a device:

```bash
# Linux and macOS. Add sudo if you installed with sudo.
curl -sSL https://hub/install.sh | sh -s -- --uninstall

# Windows
& ([scriptblock]::Create((irm https://hub/install.ps1))) -Uninstall

# Docker
docker rm -f beacon-agent && docker volume rm beacon-agent-data
```

Then delete the device in its **Settings** tab to drop its history and alerts.
Deleting the device without uninstalling the agent is safe, because it can no
longer connect.

Remove the hub along with all history and accounts:

```bash
cd beacon/docker
docker compose down --volumes
```

Leave out `--volumes` to stop the hub but keep the data.

## Troubleshooting

**A device never appears.** Check that the machine can reach the hub URL, then
read the agent log. On Linux use `journalctl --user -u beacon-agent -f`. On
macOS use `tail -f ~/.local/share/beacon-agent/agent.log`. On Windows look at
the "Beacon agent" task in Task Scheduler.

**Values only change every five seconds.** The `/live` WebSocket is not getting
through. The usual cause is a proxy that does not forward upgrade requests, or a
self-signed certificate. Everything still works, just a few seconds behind.

**"SSL certificate problem" while installing an agent.** Turn on the self-signed
certificate toggle in the Add device dialog and use the commands it gives you,
or put a real certificate in front of the hub.

**The Screen tab is unavailable.** The agent reports whether capture is actually
possible on that machine. Headless servers, Wayland sessions, containers and
`-SystemService` installs cannot be captured. The tab tells you which one
applies.

**You forgot the administrator password.** Stop the hub, delete `beacon.db` and
start it again. You will be asked to create a first account. This erases
everything else as well, so treat it as a last resort.

## Security

- Passwords are hashed. Sessions are signed, HTTP-only cookies.
- Login failures are throttled per address and per username. The limits are
  deliberately generous so that one person mistyping a password cannot lock out
  everyone else behind the same shared address.
- Enrollment tokens are hashed and shown once. Devices then hold their own key.
- Ending a process is disabled until an admin turns it on for that device, and
  is restricted to admins.
- Screen viewing is off by default, view-only, and every session is written to
  the audit log.
- Agents only make outbound connections. Nothing listens on a monitored device.
- `/install.sh`, `/install.ps1` and `/download/*` are unauthenticated on purpose.
  Nothing served there is secret.

Please report vulnerabilities privately through this repository's security
advisories rather than opening a public issue.

## Development

```
shared/   types and the agent/hub wire protocol
server/   Express API, WebSocket hub, SQLite storage, alert engine
agent/    the collector installed on each device
client/   React, TypeScript and Tailwind dashboard
docker/   images for the hub and the agent
scripts/  release build, installers, end-to-end tests
```

```bash
npm install
npm run build:shared
npm run dev:server   # API and hub on :4800
npm run dev:client   # dashboard on :5273, proxying to the API
npm run typecheck    # all four workspaces
```

The end-to-end checks all run without Docker:

```bash
node scripts/test-live.mjs            # agent to hub to browser over WebSockets
node scripts/test-launcher.mjs        # agent update rollback
node scripts/test-login-throttle.mjs  # login throttling
node scripts/check-compose.mjs        # compose files parse
```

## Versioning

The hub and the agent share a version, because they are built together. The wire
protocol between them is versioned separately, and the hub accepts a documented
range of older agents.

Patch releases are fixes only. Minor releases add features and keep older agents
working. Major releases say plainly what you need to do. Every release and its
notes are on the [releases page](https://github.com/lushbit/beacon/releases).

## Licence

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).

Run it, modify it and share it. The one obligation is this. If you run a
modified version and let other people use it over a network, you have to offer
them your changes. Running the project unmodified asks nothing of you.
