/**
 * Turns the hub's agent update state into something a person can watch.
 *
 * The agent reports stages, not bytes, so these percentages are milestones
 * rather than measured progress. They are deliberately spaced so the bar always
 * moves when the stage changes, and never sits at 100 while work is still going
 * on.
 */

export type AgentUpdateTone = "neutral" | "success" | "danger";

export interface AgentUpdateStage {
  percent: number;
  label: string;
  tone: AgentUpdateTone;
  /** True while the hub is still waiting on the device. */
  busy: boolean;
}

/** States that mean an update is in flight for this device. */
export function isUpdating(state: string): boolean {
  return state === "requested" || state === "downloading" || state === "restarting";
}

export function agentUpdateStage(state: string, targetVersion: string | null, error: string | null): AgentUpdateStage {
  switch (state) {
    case "requested":
      return { percent: 15, label: "Asking the agent to update…", tone: "neutral", busy: true };
    case "downloading":
      return {
        percent: 55,
        label: targetVersion ? `Downloading and verifying v${targetVersion}…` : "Downloading and verifying…",
        tone: "neutral",
        busy: true,
      };
    case "restarting":
      return {
        percent: 85,
        label: "Restarting into the new version…",
        tone: "neutral",
        busy: true,
      };
    case "confirmed":
      return {
        percent: 100,
        label: targetVersion ? `Updated to v${targetVersion}.` : "Update finished.",
        tone: "success",
        busy: false,
      };
    case "failed":
      return { percent: 100, label: error ?? "The update failed.", tone: "danger", busy: false };
    default:
      return { percent: 0, label: "Waiting to start.", tone: "neutral", busy: false };
  }
}
