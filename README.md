# Beacon

Beacon is a self-hosted dashboard that keeps an eye on all the machines you own,
from one place.

A small agent runs on each machine and reports back to a central hub. The agent
connects outwards, so nothing needs to listen on the machine and you never have
to forward a port. Your home server, your laptop and a VPS somewhere all get set
up the same way.

Everything stays on your own hardware. No account, no telemetry, no third party
in the middle.

## ✨ Features

**📊 Live dashboard** - CPU, memory, disks, network, temperatures, GPUs,
batteries and uptime for every machine. Readings show up as they arrive instead
of when you refresh, so the page is always current.

**📈 History that stays small** - Recent readings are kept exactly as they came
in, and older ones get averaged down over time. You can look back a year and
still have a database small enough to back up.

**🐳 Docker containers** - See which containers are running on a host and how
much they are using, next to the host's own numbers.

**🔔 Alerts** - Set a threshold on anything you can see, or get told when a
machine drops offline. A rule has to stay true for a set time before it fires,
so a short spike does not wake you at 3am.

**📬 Notifications** - Alerts reach you through ntfy, a Discord webhook, or any
endpoint of your own that takes a JSON POST.

**🖥️ Screen viewing** - Look at what a machine is actually doing without
installing anything extra on it. It is view-only, off until you turn it on for
that machine, and every session is logged.

**⚙️ Process list** - See what is running and, if you allow it for that machine,
end a process straight from the dashboard.

**🔄 Self-updating agents** - Agents update from your hub, not from the
internet. If a new build fails to start, the agent restores the old one by
itself, so a bad update cannot leave a machine unwatched.

**👥 Users and roles** - Admins can change things and viewers can only look.
Everything that matters lands in an audit log.

**🌍 Runs anywhere** - The agent is plain JavaScript, so there is nothing to
compile and the same install works on a Raspberry Pi and a rack server.

## 📦 Requirements

| | |
| --- | --- |
| **Hub** | Docker, or Node.js 20 and above |
| **Agent** | Node.js 20 and above, or Docker |
| **Systems** | Linux, macOS, Windows |
| **Architectures** | x86-64 and arm64 |
| **Port** | `4800`, which you can change |

## 🚀 Install the hub

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon/docker
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" > .env
docker compose up -d
```

Open `http://your-host:4800` and make the first administrator account. Nothing
else opens until that account exists.

`SESSION_SECRET` is what signs your login cookies. Keep the `.env` file around,
because a new secret on every start logs everyone out. Compose reads that file
on its own, which is also why `sudo docker compose up -d` works while putting
the variable on the command line would not.

Prefer to run it without Docker:

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon
npm install
./scripts/build-release.sh
cd release
SESSION_SECRET=$(openssl rand -hex 48) node server/dist/index.js
```

### Behind a reverse proxy

Point your proxy at `127.0.0.1:4800` and add `TRUST_PROXY=1` to the same `.env`
file you put the secret in, next to `docker/compose.yaml`. Compose passes it
through. Without it Beacon sees your proxy as the client for every request,
which throws off the login rate limit. Running from source instead, set it in
the environment next to `SESSION_SECRET`.

The part worth getting right is WebSockets. Two paths have to be forwarded as
upgrades, `/live` for the browser and `/agent` for your machines. Caddy does
this by itself. On nginx you need `proxy_http_version 1.1` plus the `Upgrade`
and `Connection` headers. Miss it and the dashboard drops back to refreshing
every five seconds while agents cannot connect at all.

## 💻 Add a device

Press **Add device** on the overview. Beacon hands you a token and the right
command for the machine. The token is shown once and only works for signing up.
After a machine connects it keeps a key of its own, so you can throw the token
away.

If your hub uses a self-signed certificate, flip the toggle in the dialog first
and the commands come back with the flags needed to accept it.

A device that already reports to another hub moves across when you run the
installer again with a token from the new dashboard. Without a token it refuses
rather than quietly staying where it was.

### Linux

```bash
curl -sSL https://hub/install.sh | sh -s -- --url https://hub --token TOKEN
```

Installs into `~/.local/share/beacon-agent` and runs as a user service. Put
`sudo` in front and it goes to `/opt/beacon-agent` as a system service instead,
which starts before anyone logs in.

Some appliance systems, NAS boxes in particular, never start a systemd user
instance. The installer detects that and asks you to run the same command with
`sudo`. It also waits for the agent to reach the hub before it reports success,
so a device that never appears on the dashboard tells you why on the spot.

### macOS

```bash
curl -sSL https://hub/install.sh | sh -s -- --url https://hub --token TOKEN
```

Same command as Linux. It sets up a launchd agent for your user and writes its
log to `~/.local/share/beacon-agent/agent.log`.

### Windows

```powershell
& ([scriptblock]::Create((irm https://hub/install.ps1))) -Url https://hub -Token TOKEN
```

Runs in your desktop session, which is what lets screen viewing work. On a
server nobody signs into, add `-SystemService` from an admin prompt and it
starts with the machine instead, without screen capture.

### Docker

```bash
docker build -t beacon-agent https://hub/download/beacon-agent-docker.tar.gz
```

The build context comes from your hub, so the machine needs neither git nor
access to this repository. Give it `--network host --pid host` and the Docker
socket read-only to see both the host and its containers. Screen viewing is not
possible from inside a container. The dialog prints the full `docker run` line
for you.

## 🔔 Alerts and notifications

Every machine starts with sensible rules for high CPU, high memory, a filling
disk and going offline. Edit those or add your own under **Alerts**, for one
machine or for all of them at once.

A rule is a metric, a threshold, and how long it has to hold before Beacon says
anything. Each one carries a severity of info, warning or critical, plus a
cooldown so you are not told the same thing over and over.

What you can alert on:

| | |
| --- | --- |
| **CPU** | Usage, temperature, and 1-minute load average |
| **Memory** | Memory and swap usage |
| **Disk** | Usage on the busiest volume |
| **Network** | Download and upload rate |
| **GPU** | Usage |
| **Battery** | Charge level |
| **Docker** | Number of running containers |
| **Status** | Machine went offline |

Where they get sent, set under **Settings**:

| | |
| --- | --- |
| **ntfy** | Your own server or the hosted `ntfy.sh`. Give it a URL and a topic |
| **Discord** | Paste in a channel webhook URL |
| **Webhook** | Any endpoint that accepts a JSON POST, for wiring into something else |

Each one has its own minimum severity, so you can send everything to ntfy but
only wake Discord for critical alerts. There is a test button next to each.

## 🔄 Updating

The hub tells you when a new version is out and links the notes for it. To take
it:

```bash
cd beacon && git pull
cd docker && docker compose up -d --build
```

Your data sits on a volume and a rebuild leaves it alone. Database changes are
applied when it starts.

Agents are updated from the dashboard. Do one machine at a time, or all of them
at once under **Settings**, or set a nightly window and stop thinking about it.

## 🗑️ Removing Beacon

### An agent, from a machine

```bash
# Linux and macOS. Add sudo if you installed with sudo.
curl -sSL https://hub/install.sh | sh -s -- --uninstall

# Windows
& ([scriptblock]::Create((irm https://hub/install.ps1))) -Uninstall
```

That stops the service, unregisters it, and deletes the install folder along
with the machine's key. Nothing is left behind. For a Docker agent:

```bash
docker rm -f beacon-agent
docker volume rm beacon-agent-data
docker image rm beacon-agent
```

Afterwards, delete the device in the dashboard to drop its history and alerts.
You can also delete it there first, since a removed device can no longer connect
anyway.

### The hub

```bash
cd beacon/docker
docker compose down --volumes --rmi local
```

`--volumes` deletes the database with all of your history and accounts, and
`--rmi local` deletes the image that was built for it. Leave both off to just
stop the hub and keep everything.

Then delete the folder you cloned:

```bash
cd ../.. && rm -rf beacon
```

## 🛠️ Troubleshooting

**A machine never turns up.** First check it can reach the hub URL at all, then
read the agent log. On Linux run `journalctl --user -u beacon-agent -f`, or drop
`--user` for a system install. On macOS run
`tail -f ~/.local/share/beacon-agent/agent.log`. On Windows look up the "Beacon
agent" task in Task Scheduler.

**Numbers only move every five seconds.** The `/live` WebSocket is not getting
through, almost always a proxy that will not forward upgrade requests. Nothing
is broken, you are just seeing things a few seconds late.

**An SSL error while installing an agent.** Turn on the self-signed certificate
toggle in the Add device dialog and use the commands it gives back, or put a
proper certificate in front of the hub.

**The screen tab is greyed out.** Some machines cannot be captured at all.
Headless servers, Wayland sessions, containers and `-SystemService` installs are
the usual ones, and the tab tells you which applies.

**You lost the admin password.** Stop the hub, delete `beacon.db`, and start it
again to be asked for a new first account. This clears everything else too, so
keep it as a last resort.

## 📄 Licence

Beacon is free software under the GNU Affero General Public License v3.0 or
later. See [LICENSE](LICENSE).

Run it, change it, pass it on. The one condition is that if you run a modified
version and let other people use it over a network, you offer them your changes.
Running it as-is asks nothing of you.
