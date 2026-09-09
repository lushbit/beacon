#!/bin/sh
# Beacon agent installer for Linux and macOS.
#
#   curl -sSL https://your-hub/install.sh | sh -s -- --url https://your-hub --token TOKEN
#
# Installs the agent, registers it as a service, and starts it. Run as root for
# a system-wide service, or as your own user for a per-user one.
set -eu

URL=""
TOKEN=""
INSTALL_DIR=""
INSECURE_TLS=""
UNINSTALL=""
SERVICE_NAME="beacon-agent"

die() {
  echo "error: $*" >&2
  exit 1
}

info() {
  echo "  $*"
}

usage() {
  cat <<'USAGE'
Beacon agent installer

  --url <url>       Hub address, e.g. https://beacon.example.com
  --token <token>   Enrollment token from the dashboard
  --dir <path>      Install location (default depends on privileges)
  --insecure-tls    Accept a self-signed certificate on the hub
  --uninstall       Stop, disable and remove the agent
  --help            Show this message
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --insecure-tls) INSECURE_TLS="1"; shift ;;
    --uninstall) UNINSTALL="1"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

if [ "$(id -u)" = "0" ]; then
  IS_ROOT="1"
  DEFAULT_DIR="/opt/beacon-agent"
else
  IS_ROOT=""
  DEFAULT_DIR="$HOME/.local/share/beacon-agent"
fi
[ -n "$INSTALL_DIR" ] || INSTALL_DIR="$DEFAULT_DIR"

OS="$(uname -s)"
case "$OS" in
  Linux) PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *) die "unsupported operating system: $OS" ;;
esac

# --------------------------------------------------------------------- uninstall

uninstall() {
  echo "Removing the Beacon agent…"
  if [ "$PLATFORM" = "linux" ]; then
    if [ -n "$IS_ROOT" ]; then
      systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      systemctl disable "$SERVICE_NAME" 2>/dev/null || true
      rm -f "/etc/systemd/system/$SERVICE_NAME.service"
      systemctl daemon-reload 2>/dev/null || true
    else
      systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
      systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
      rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
      systemctl --user daemon-reload 2>/dev/null || true
    fi
  else
    PLIST="$HOME/Library/LaunchAgents/dev.beacon.agent.plist"
    [ -n "$IS_ROOT" ] && PLIST="/Library/LaunchDaemons/dev.beacon.agent.plist"
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
  fi
  rm -rf "$INSTALL_DIR"
  echo "Done. The device stays in the dashboard until you remove it there."
  exit 0
}

[ -n "$UNINSTALL" ] && uninstall

# ------------------------------------------------------------------ preflight

[ -n "$URL" ] || die "--url is required"

# Trim any trailing slash so the download path is predictable.
URL="$(printf '%s' "$URL" | sed 's#/*$##')"

command -v node >/dev/null 2>&1 || die "Node.js 20 or newer is required but was not found.
Install it from https://nodejs.org (or your package manager) and run this again.
Devices without Node.js can run the agent with the Docker command instead, which
the dashboard shows on the Docker tab of \"Add a device\"."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || die "Node.js 20 or newer is required (found $(node -v 2>/dev/null || echo none))."

if command -v curl >/dev/null 2>&1; then
  DOWNLOAD="curl -fsSL"
  [ -n "$INSECURE_TLS" ] && DOWNLOAD="curl -fsSLk"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD="wget -qO-"
  [ -n "$INSECURE_TLS" ] && DOWNLOAD="wget --no-check-certificate -qO-"
else
  die "either curl or wget is required"
fi

echo "Beacon agent installer"
info "hub:      $URL"
info "platform: $PLATFORM"
info "install:  $INSTALL_DIR"

# ------------------------------------------------------------------- download

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM

echo "Asking the hub which agent build to install…"
# shellcheck disable=SC2086
$DOWNLOAD "$URL/download/manifest.json" > "$TMP_DIR/manifest.json" \
  || die "could not reach $URL/download/manifest.json"

VERSION="$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.version||"")' "$TMP_DIR/manifest.json")"
FILENAME="$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.filename||"")' "$TMP_DIR/manifest.json")"
EXPECTED_SHA="$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.sha256||"")' "$TMP_DIR/manifest.json")"
[ -n "$VERSION" ] && [ -n "$FILENAME" ] || die "the hub returned an unusable manifest"
info "version:  $VERSION"

echo "Downloading the agent…"
# shellcheck disable=SC2086
$DOWNLOAD "$URL/download/$FILENAME" > "$TMP_DIR/agent.tar.gz" \
  || die "could not download $URL/download/$FILENAME"
[ -s "$TMP_DIR/agent.tar.gz" ] || die "the downloaded agent bundle was empty"

if [ -n "$EXPECTED_SHA" ]; then
  ACTUAL_SHA="$(node -e '
    const { createHash } = require("crypto");
    const { readFileSync } = require("fs");
    process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
  ' "$TMP_DIR/agent.tar.gz")"
  [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "checksum mismatch — the download does not match what the hub published"
  info "checksum: verified"
fi

# Versioned layout: the launcher stays put while versions come and go, which is
# what lets the agent replace itself later without touching the service.
TARGET_DIR="$INSTALL_DIR/versions/$VERSION"
mkdir -p "$TARGET_DIR"
rm -rf "${TARGET_DIR:?}/"*
tar -xzf "$TMP_DIR/agent.tar.gz" -C "$TARGET_DIR" || die "could not unpack the agent bundle"
[ -f "$TARGET_DIR/agent/dist/index.js" ] || die "the agent bundle looks incomplete"

cp "$TARGET_DIR/launcher.mjs" "$INSTALL_DIR/launcher.mjs" 2>/dev/null \
  || die "the agent bundle is missing its launcher"

PREVIOUS_VERSION=""
if [ -f "$INSTALL_DIR/current.json" ]; then
  PREVIOUS_VERSION="$(node -e '
    try { process.stdout.write(require(process.argv[1]).version || ""); } catch { process.stdout.write(""); }
  ' "$INSTALL_DIR/current.json")"
fi

cat > "$INSTALL_DIR/current.json" <<STATE
{
  "version": "$VERSION",
  "previous": $([ -n "$PREVIOUS_VERSION" ] && [ "$PREVIOUS_VERSION" != "$VERSION" ] && echo "\"$PREVIOUS_VERSION\"" || echo null),
  "pendingSince": null,
  "failures": 0
}
STATE

# --------------------------------------------------------------------- config

CONFIG_FILE="$INSTALL_DIR/agent.json"
if [ -f "$CONFIG_FILE" ]; then
  info "keeping the existing configuration (this device stays enrolled)"
else
  [ -n "$TOKEN" ] || die "--token is required the first time (create one in the dashboard)"
  INSTALL_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
  UMASK_OLD="$(umask)"
  umask 077
  cat > "$CONFIG_FILE" <<CONFIG
{
  "url": "$URL",
  "token": "$TOKEN",
  "installId": "$INSTALL_ID",
  "insecureTls": $([ -n "$INSECURE_TLS" ] && echo true || echo false)
}
CONFIG
  umask "$UMASK_OLD"
  chmod 600 "$CONFIG_FILE"
fi

NODE_BIN="$(command -v node)"
EXEC="$NODE_BIN $INSTALL_DIR/launcher.mjs --config $CONFIG_FILE"

# -------------------------------------------------------------------- service

# `systemctl --user` needs a login session with its own bus. Plenty of appliance
# systems (NAS boxes especially) never start one, and the installer used to fail
# there with systemd's own error, after writing the configuration.
user_systemd_available() {
  [ -n "${XDG_RUNTIME_DIR:-}" ] || return 1
  systemctl --user show-environment >/dev/null 2>&1
}

install_systemd() {
  UNIT_BODY="[Unit]
Description=Beacon monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$EXEC
Restart=always
RestartSec=10
WorkingDirectory=$INSTALL_DIR

[Install]
"

  if [ -n "$IS_ROOT" ]; then
    printf '%sWantedBy=multi-user.target\n' "$UNIT_BODY" > "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    systemctl restart "$SERVICE_NAME"
    SERVICE_MODE="system"
    info "service: systemd (system) — journalctl -u $SERVICE_NAME -f"
  else
    if ! user_systemd_available; then
      die "this session has no systemd user instance, so a per-user service cannot be
installed. Re-run the same command as root, which installs a system-wide
service instead:

  curl -sSL $URL/install.sh | sudo sh -s -- --url $URL --token <token>"
    fi
    mkdir -p "$HOME/.config/systemd/user"
    printf '%sWantedBy=default.target\n' "$UNIT_BODY" > "$HOME/.config/systemd/user/$SERVICE_NAME.service"
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    systemctl --user restart "$SERVICE_NAME"
    # Without lingering the agent stops the moment you log out.
    loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
    SERVICE_MODE="user"
    info "service: systemd (user) — journalctl --user -u $SERVICE_NAME -f"
  fi
}

install_launchd() {
  LABEL="dev.beacon.agent"
  if [ -n "$IS_ROOT" ]; then
    PLIST="/Library/LaunchDaemons/$LABEL.plist"
  else
    mkdir -p "$HOME/Library/LaunchAgents"
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  fi

  cat > "$PLIST" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/launcher.mjs</string>
    <string>--config</string>
    <string>$CONFIG_FILE</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/agent.log</string>
</dict>
</plist>
PLIST_BODY

  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  SERVICE_MODE="launchd"
  info "service: launchd — tail -f $INSTALL_DIR/agent.log"
}

SERVICE_MODE=""

echo "Installing the service…"
if [ "$PLATFORM" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
  install_systemd
elif [ "$PLATFORM" = "macos" ]; then
  install_launchd
else
  cat <<MANUAL

No supported service manager was found, so the agent was installed but not
registered. Start it yourself with:

  $EXEC

MANUAL
  exit 0
fi

# --------------------------------------------------------------------- verify

# The installer used to announce success as soon as the service manager accepted
# the unit. A service that dies on startup, an unreachable hub and a spent token
# all looked exactly like a working install, and the device simply never
# appeared. Wait for the agent to actually enroll, and show its log if it does
# not.
WAIT_SECONDS=45

service_running() {
  case "$SERVICE_MODE" in
    system) systemctl is-active --quiet "$SERVICE_NAME" ;;
    user) systemctl --user is-active --quiet "$SERVICE_NAME" ;;
    launchd) launchctl list "dev.beacon.agent" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# The hub swaps the enrollment token for one unique to this device, and the agent
# writes it to its config. Nothing else proves the two ends actually talked.
enrolled() {
  grep -q '"deviceToken"' "$CONFIG_FILE" 2>/dev/null
}

show_log() {
  case "$SERVICE_MODE" in
    system) journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null || true ;;
    user) journalctl --user -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null || true ;;
    launchd) tail -n 20 "$INSTALL_DIR/agent.log" 2>/dev/null || true ;;
  esac
}

echo "Waiting for the agent to reach the hub…"
WAITED=0
while [ "$WAITED" -lt "$WAIT_SECONDS" ]; do
  if service_running && enrolled; then
    echo
    echo "Done. This device is enrolled and reporting to $URL."
    exit 0
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

{
  echo
  if service_running; then
    echo "The agent is running but has not reached $URL after ${WAIT_SECONDS}s."
    echo "Check that the hub is reachable from this device, and that the enrollment"
    echo "token has not expired or been used up."
  else
    echo "The agent was installed but its service is not running."
  fi
  echo
  echo "Last log lines:"
  show_log
} >&2
exit 1
