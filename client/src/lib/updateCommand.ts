/**
 * The one place the hub update command is written. The dashboard and the README
 * used to disagree, and the dashboard's `docker compose pull` did nothing at
 * all: the compose file builds the image from the checkout, so there is nothing
 * published to pull.
 */
export const HUB_UPDATE_COMMAND = "cd beacon && git pull\ncd docker && docker compose up -d --build";
