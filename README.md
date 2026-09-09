# Beacon

Beacon watches the machines you own and puts them on one dashboard.

You run the hub on a machine of your choice. You install a small agent on every
machine you want to keep an eye on. The agents connect outwards to the hub and
send their readings, so nothing has to listen on the machines themselves and you
never have to forward a port. A laptop behind a home router, a server behind a
company firewall and a VPS in a data centre are all set up the same way.

It all runs on your own hardware. There is nothing to sign up for, no telemetry
and no third-party service in the middle. Beacon is free software under the
AGPL-3.0-or-later.

## What it does

The dashboard shows you CPU, memory, disks, network, temperatures, GPUs,
batteries and uptime for every machine, along with what is currently running and
any Docker containers on it. Values arrive as they happen rather than on a
refresh, so the page is live while you are looking at it.

History is kept without the database growing out of hand. Recent readings are
stored exactly as they came in, and older ones are averaged down as they age, so
you can look back over a year and still have a small file to back up.

You can set alerts on anything you can see, and on a machine going offline. A
rule waits for the condition to hold for a while before it fires, so a brief
spike does not wake you up at three in the morning. Alerts go to ntfy, to
Discord, or to any webhook you point them at.

There is a view-only screen viewer for when you need to see what a machine is
actually doing. It is off until you turn it on for that machine, and every
session is written to the audit log. You can also end a process from the
dashboard, if you have allowed it for that machine.

Agents update themselves from your hub rather than from the internet. If a new
version fails to start, the agent puts the old one back on its own, so a bad
update cannot quietly leave a machine unwatched.

Accounts come with two roles. Admins can change things and viewers can only
look.

## Requirements

The hub needs either Docker or Node.js 20. The agent needs the same, and runs on
Linux, macOS and Windows, on both x86-64 and arm64. The agent is plain
JavaScript, so there is nothing to compile on the machines you are watching.

The hub listens on port 4800 by default.

## Install the hub

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon/docker
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" > .env
docker compose up -d
```

Open `http://your-host:4800` and create the first administrator account. Nothing
else is reachable until that account exists.

`SESSION_SECRET` signs the login cookies. Keep the `.env` file, because a fresh
secret on every start signs everyone out. Compose reads the file itself, which
is also why `sudo docker compose up -d` works when passing the variable on the
command line would not.

If you would rather not use Docker:

```bash
git clone https://github.com/lushbit/beacon.git
cd beacon
npm install
./scripts/build-release.sh
cd release
SESSION_SECRET=$(openssl rand -hex 48) node server/dist/index.js
```

### Putting it behind a reverse proxy

Point your proxy at `127.0.0.1:4800` and set `TRUST_PROXY=1` so Beacon sees real
client addresses instead of the proxy's.

The one thing to get right is WebSockets. Two paths need to be forwarded as
upgrades, `/live` for the browser and `/agent` for your machines. Caddy does
this on its own. nginx needs `proxy_http_version 1.1` along with the `Upgrade`
and `Connection` headers. Without it the dashboard falls back to refreshing
every five seconds and agents cannot connect at all.

## Add a device

Press **Add device** on the overview. Beacon gives you a token and the command
to run on the machine.

| | |
| --- | --- |
| Linux, macOS | `curl -sSL https://hub/install.sh \| sh -s -- --url https://hub --token TOKEN` |
| Windows | `& ([scriptblock]::Create((irm https://hub/install.ps1))) -Url https://hub -Token TOKEN` |
| Docker | `docker build -t beacon-agent https://hub/download/beacon-agent-docker.tar.gz` |

The agent installs itself as a service and starts reporting. The token is shown
once and is only good for enrolling. Once a machine has connected it holds a key
of its own, so there is no need to keep the token around.

On Linux the agent runs as a user service, or as a system one if you install it
with `sudo`. On Windows it runs in your desktop session, which is what makes
screen viewing work. For a server nobody logs into, add `-SystemService` from an
elevated prompt and it will start with the machine instead, without screen
capture. If your hub uses a self-signed certificate, turn on the toggle in the
dialog and the commands will come back with the flags needed to accept it.

## Alerts

Every new machine starts with sensible rules for high CPU, high memory, a
filling disk and going offline. You can edit those or write your own under
**Alerts**, either for one machine or for all of them.

Where they go is set under **Settings**, and you can send them to ntfy, to a
Discord webhook, or to any endpoint that accepts a JSON POST. Each one has a
minimum severity and a button to send a test.

## Updating

Update the hub by pulling and rebuilding:

```bash
cd beacon && git pull
cd docker && docker compose up -d --build
```

Your data lives on a volume and a rebuild does not touch it. Database changes
are applied on startup. The hub also tells you when a new version exists and
links the notes for it.

Agents are updated from the dashboard, either one at a time, or all at once
under **Settings**, or on a nightly schedule if you would rather not think about
it.

## Removing things

To remove an agent from a machine:

```bash
# Linux and macOS. Add sudo if you installed with sudo.
curl -sSL https://hub/install.sh | sh -s -- --uninstall

# Windows
& ([scriptblock]::Create((irm https://hub/install.ps1))) -Uninstall

# Docker
docker rm -f beacon-agent && docker volume rm beacon-agent-data
```

Then delete the device in the dashboard to drop its history and alerts. Deleting
it there without uninstalling the agent is fine too, because it can no longer
connect.

To remove the hub and everything in it:

```bash
cd beacon/docker
docker compose down --volumes
```

Leave off `--volumes` to stop the hub but keep your data.

## Troubleshooting

**A machine never shows up.** Check it can actually reach the hub URL, then read
the agent's log. On Linux that is `journalctl --user -u beacon-agent -f`, on
macOS `~/.local/share/beacon-agent/agent.log`, and on Windows the "Beacon agent"
task in Task Scheduler.

**Everything updates every five seconds instead of live.** The `/live` WebSocket
is not getting through, usually because of a proxy that does not forward
upgrades. Nothing is broken, it is just a few seconds behind.

**An SSL error while installing an agent.** Turn on the self-signed certificate
toggle in the Add device dialog and use the commands it gives you, or put a real
certificate in front of the hub.

**The screen tab is greyed out.** Not every machine can be captured. Headless
servers, Wayland sessions, containers and `-SystemService` installs cannot be,
and the tab says which one applies.

**You forgot the admin password.** Stop the hub, delete `beacon.db` and start it
again to be asked for a new first account. This wipes everything else too, so it
really is a last resort.

## Licence

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).

Run it, change it, share it. The only condition is that if you run a modified
version and let other people use it over a network, you offer them your changes.
Running it unmodified asks nothing of you.
