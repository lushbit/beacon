/**
 * Commands that run the hub's own install scripts, shared by the dialogs that
 * add and remove a device so the two always fetch the scripts the same way.
 */

/**
 * Windows PowerShell checks the certificate while downloading the script, before
 * the script is there to read -InsecureTls. With a self-signed hub the check has
 * to be switched off in front of the download, or the command fails at once.
 */
const SKIP_CERTIFICATE_CHECK = "[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }; ";

/** Runs install.ps1 with the given arguments. */
export function windowsScriptCommand(hubUrl: string, args: string, insecure: boolean): string {
  const command = `& ([scriptblock]::Create((irm ${hubUrl}/install.ps1))) -Url ${hubUrl} ${args}`;
  return insecure ? `${SKIP_CERTIFICATE_CHECK}${command} -InsecureTls` : command;
}

/** Downloads install.sh, ready to be piped into a shell. */
export function shellScriptDownload(hubUrl: string, insecure: boolean): string {
  return `curl -sSL${insecure ? "k" : ""} ${hubUrl}/install.sh`;
}
