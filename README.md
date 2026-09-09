# Beacon

Self-hosted monitoring for machines you own. One dashboard for CPU, memory,
disks, network, temperatures, GPUs, batteries, processes and Docker containers,
with alerting, history and per-device access control.

No accounts, no telemetry, no third-party services. Licensed AGPL-3.0-or-later.

```
  device ─┐
  device ─┼─── outbound WebSocket ───▶  hub  ──▶  browser
  device ─┘                          (SQLite)
```

Agents dial out to the hub, so devices behind NAT, a home router or a corporate
firewall need no port forwarding and expose no listening service.

## Highlights

- **One command per device.** The dashboard generates it; the agent installs
  itself as a systemd unit, launchd agent or scheduled task.
- **Live by default.** Values arrive over a WebSocket as devices report them,
  with automatic fallback to polling where WebSockets are blocked.
- **History that stays small.** Tiered downsampling in SQLite: raw for 48h,
  one-minute averages for 30 days, hourly for a year. All three configurable.
- **Alerting** on thresholds and offline devices, delivered to ntfy, Discord or
  any webhook.
- **Remote screen**, view-only, off by default, per device, every session
  audited.
- **Agent updates from the hub** — one click or on a schedule, with automatic
  rollback if the new build fails to start.
- **Roles.** Admins change things; viewers only look.

## Requirements

| | |
| --- | --- |
| Hub | Docker, or Node.js 20+ |
| Agent | Node.js 20+, or Docker |
| Platforms | Linux, macOS, Windows |
| Architectures | x86-64 and arm64 (the agent is pure JavaScript) |
| Port | `4800` by default |

## Install the hub

### Docker

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon/docker
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" > .env
docker compose up -d
```

Open `http://<host>:4800` and create the first administrator account. Until that
account exists no other page is reachable.

`SESSION_SECRET` signs session cookies. Keep `.env`: a new value on every start
signs everyone out. Compose reads the file itself, so `sudo docker compose up -d`
works — passing the variable through `sudo` does not, because sudo clears the
environment.

### From source

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon
npm install
./scripts/build-release.sh
cd release
SESSION_SECRET=$(openssl rand -hex 48) node server/dist/index.js
```

`scripts/build-release.sh` produces exactly what the Docker image ships:
`release/` is self-contained and runs with `node server/dist/index.js`.

### Behind a reverse proxy

Terminate TLS in front of the hub, point it at `127.0.0.1:4800` and set
`TRUST_PROXY=1` so rate limiting sees real client addresses.

Two paths must be forwarded as WebSockets: `/live` for browsers and `/agent`
for devices. Without them the dashboard falls back to five-second polling and
agents cannot connect at all.

Caddy handles both without configuration:

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

**Add device** on the Overview page issues an enrollment token — optionally
limited to a number of devices and an expiry — and shows the command for each
platform. Tokens are stored hashed and displayed once; on first connection the
agent exchanges it for a key unique to that device.

| Platform | Command |
| --- | --- |
| Linux, macOS | `curl -sSL https://hub/install.sh \| sh -s -- --url https://hub --token TOKEN` |
| Windows | `& ([scriptblock]::Create((irm https://hub/install.ps1))) -Url https://hub -Token TOKEN` |
| Docker | `docker build -t beacon-agent https://hub/download/beacon-agent-docker.tar.gz` |

Notes per platform:

- **Linux** installs a user systemd unit; with `sudo`, a system-wide one.
- **macOS** installs a launchd agent for the current user.
- **Windows** starts the agent in your desktop session, which is what makes
  screen viewing possible. For a server nobody logs into, add `-SystemService`
  from an elevated prompt: it starts with the machine, without screen capture.
- **Docker** builds from a context the hub serves, so the host needs neither git
  nor access to this repository. Run it with `--network host --pid host` and the
  Docker socket mounted read-only to see host and container metrics; screen
  viewing is unavailable from a container. The dashboard prints the full
  `docker run` line.
- **Self-signed certificate?** Toggle it in the dialog and the commands gain the
  flags needed to skip verification, including for the download itself.

## Configuration

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | — | **Required in production.** Signs session cookies |
| `PORT` | `4800` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `DATABASE_PATH` | `data/beacon.db` | SQLite file, absolute or relative to the server package |
| `TRUST_PROXY` | `0` | `1` when a reverse proxy terminates TLS |
| `PUBLIC_DIR` | `../public` | Where installers and agent bundles are served from |
| `BEACON_UPDATE_REPO` | this repository | Release feed the update check reads |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOGIN_WINDOW_SEC` | `900` | Login throttling window |
| `LOGIN_PAIR_LIMIT` | `20` | Failures per address and username before refusal |
| `LOGIN_IP_LIMIT` | `100` | Failures per address across usernames |
| `LOGIN_MAX_DELAY_MS` | `8000` | Ceiling on the delay added to a wrong password |

### Server settings

Under **Settings → Server**, stored in the database rather than the environment:

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

Sample interval, offline threshold, visible disks and interfaces, process
control and screen capture are all overridable per device.

### Agent

```
--url <hub>        --token <token>     --config <path>
--insecure-tls     --uninstall         --version   --help
```

Configuration lives beside the agent (`agent.json`, or `/data/agent.json` in
Docker) and holds the hub URL and the device key.

## Alerts

Each new device gets rules for high CPU, high memory, a filling disk and going
offline. Edit them or add your own under **Alerts → Rules**; rules can be scoped
to one device or all of them, with a severity and a sustained duration before
firing.

Delivery is configured in **Settings → Notifications**:

| Channel | Configuration |
| --- | --- |
| ntfy | Server URL and topic; works with the hosted `ntfy.sh` or your own |
| Discord | Webhook URL |
| Webhook | Any endpoint that accepts a JSON POST |

Each channel has a minimum severity and a test button.

## Data and backups

Everything lives in one SQLite database: metrics, devices, users, alerts, audit
log. In Docker it is `/data/beacon.db` on the `beacon-data` volume.

The database runs in WAL mode, so copying the file while the hub is running can
produce an inconsistent snapshot. Take a consistent one without stopping
anything:

```bash
docker compose exec beacon \
  node -e "require('better-sqlite3')('/data/beacon.db').backup('/data/backup.db').then(()=>process.exit(0))"
docker compose cp beacon:/data/backup.db ./beacon-backup.db
```

To restore: stop the hub, put the file back as `beacon.db`, delete any stale
`beacon.db-wal` and `beacon.db-shm` beside it, start the hub again.

## Updating

**The hub** compares itself against the release feed at startup, every six hours
and on sign-in, and links the release notes in the sidebar when a newer version
exists.

```bash
cd beacon && git pull
cd docker && docker compose up -d --build
```

Data lives on a volume and is untouched by a rebuild. Migrations run at startup.

**The agents** update from your hub, never from the internet. Press **Update**
on a device, or **Update all agents** in Settings → About, or set a policy and a
nightly window. A build that fails to start twice is rolled back to the previous
version automatically.

## Uninstall

Remove an agent from a device:

```bash
# Linux, macOS — add sudo if you installed with sudo
curl -sSL https://hub/install.sh | sh -s -- --uninstall

# Windows
& ([scriptblock]::Create((irm https://hub/install.ps1))) -Uninstall

# Docker
docker rm -f beacon-agent && docker volume rm beacon-agent-data
```

Then delete the device in its **Settings** tab to drop its history and alerts.
Removing the device without uninstalling the agent is safe: it can no longer
connect.

Remove the hub, including all history and accounts:

```bash
cd beacon/docker
docker compose down --volumes
```

Omit `--volumes` to stop the hub but keep the data.

## Troubleshooting

**A device never appears.** Check the machine can reach the hub URL, then read
the agent log: `journalctl --user -u beacon-agent -f` on Linux,
`tail -f ~/.local/share/beacon-agent/agent.log` on macOS, Task Scheduler →
"Beacon agent" on Windows.

**Values only change every five seconds.** The `/live` WebSocket is not getting
through — usually a proxy that does not forward upgrades, or a self-signed
certificate. Everything still works, a few seconds behind.

**`SSL certificate problem` while installing an agent.** Enable the self-signed
certificate toggle in the Add device dialog and use the commands it produces, or
put a real certificate in front of the hub.

**The Screen tab is unavailable.** The agent reports whether capture is possible.
Headless servers, Wayland sessions, containers and `-SystemService` installs
cannot be captured; the tab says which applies.

**Forgotten administrator password.** Stop the hub, delete `beacon.db` and start
it again to be asked for a first account. This erases everything else too.

## Security

- Passwords are hashed; sessions are signed, HTTP-only cookies.
- Login failures are throttled per address and per username pair, deliberately
  tolerant so one person mistyping cannot lock out everyone behind a shared
  proxy address.
- Enrollment tokens are hashed and shown once; devices then hold their own key.
- Ending processes is disabled per device until an admin enables it, and is
  restricted to admins.
- Screen viewing is off by default, view-only, and every session is written to
  the audit log.
- Agents make outbound connections only. Nothing listens on a monitored device.
- `/install.sh`, `/install.ps1` and `/download/*` are unauthenticated by design;
  nothing served there is secret.

Report vulnerabilities privately through the repository's security advisories
rather than a public issue.

## Development

```
shared/   types and the agent/hub wire protocol
server/   Express API, WebSocket hub, SQLite storage, alert engine
agent/    the collector installed on each device
client/   React + TypeScript + Tailwind dashboard
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

End-to-end checks, all runnable without Docker:

```bash
node scripts/test-live.mjs            # agent → hub → browser over WebSockets
node scripts/test-launcher.mjs        # agent update rollback
node scripts/test-login-throttle.mjs  # login throttling
node scripts/check-compose.mjs        # compose files parse
```

## Versioning

The hub and agent share a version; the wire protocol between them is versioned
separately, and the hub accepts a documented range of older agents. Patch
releases are fixes only, minor releases add features and keep older agents
working, major releases say what an operator must do. Release notes are on the
[releases page](https://github.com/lushbit/beacon/releases).

## Licence

GNU Affero General Public License v3.0 or later — see [LICENSE](LICENSE).

Run it, modify it, share it. The one obligation: if you run a modified version
and let others use it over a network, offer them your changes. Running the
unmodified project asks nothing of you.
