import { useEffect, useState } from "react";
import { ArrowUpCircle, Github, Sparkles } from "lucide-react";
import { CommandSteps } from "@/components/CommandSteps";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { ReleaseNotes } from "@/components/ReleaseNotes";
import { useAuth } from "@/context/AuthContext";
import { useVersion } from "@/context/VersionContext";
import { HUB_UPDATE_COMMAND } from "@/lib/updateCommand";

/**
 * Two notices, both shown once and then remembered per version so nobody is
 * nagged on every visit.
 *
 * - What changed, after this hub was updated. Everyone sees it once.
 * - A new version is out. Only admins, since nobody else can act on it.
 *
 * The keys hold a version rather than a flag, which is what makes the next
 * update show its own notice without anything having to reset them.
 */
const NOTES_SEEN = "beacon.notesSeen";
const UPDATE_SEEN = "beacon.updateSeen";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private browsing: the notice comes back next time, which is harmless */
  }
}

export function UpdateNotices() {
  const { info } = useVersion();
  const { session } = useAuth();
  const isAdmin = session?.user.role === "admin";

  const [notesSeen, setNotesSeen] = useState(() => read(NOTES_SEEN));
  const [updateSeen, setUpdateSeen] = useState(() => read(UPDATE_SEEN));

  const installed = info?.installed ?? null;
  const latest = info?.latest ?? null;

  // Only the notes for the version actually running, so a newer release waiting
  // upstream is never mistaken for what this hub just installed.
  const showNotes = Boolean(
    info && installed && installed.notes && installed.version === info.current && notesSeen !== info.current
  );
  const showUpdate = Boolean(!showNotes && isAdmin && info?.updateAvailable && latest && updateSeen !== latest.version);

  // A tab left open across an update would otherwise keep its stale answer.
  useEffect(() => {
    setNotesSeen(read(NOTES_SEEN));
    setUpdateSeen(read(UPDATE_SEEN));
  }, [info?.current, latest?.version]);

  const closeNotes = () => {
    if (!info) return;
    remember(NOTES_SEEN, info.current);
    setNotesSeen(info.current);
  };

  const closeUpdate = () => {
    if (!latest) return;
    remember(UPDATE_SEEN, latest.version);
    setUpdateSeen(latest.version);
  };

  return (
    <>
      <Dialog open={showNotes} onOpenChange={(open) => !open && closeNotes()}>
        <DialogContent>
          <DialogHeader
            title={`Beacon ${info?.current ?? ""} is installed`}
            description="Here is what changed in this version."
          />
          <div className="flex items-start gap-2.5 rounded-md border border-border/60 bg-surface-2 p-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
            {installed ? <ReleaseNotes body={installed.notes} className="min-w-0 flex-1" /> : null}
          </div>
          <DialogFooter>
            {installed?.url ? (
              <Button variant="secondary" asChild>
                <a href={installed.url} target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4" />
                  Open on GitHub
                </a>
              </Button>
            ) : null}
            <Button variant="primary" onClick={closeNotes}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showUpdate} onOpenChange={(open) => !open && closeUpdate()}>
        <DialogContent>
          <DialogHeader
            title={`Version ${latest?.version ?? ""} is available`}
            description={`This hub runs ${info?.current ?? ""}.`}
          />
          <div className="space-y-2 rounded-md border border-border/60 bg-surface-2 p-3">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <ArrowUpCircle className="h-4 w-4 shrink-0 text-info" />
              Update this hub
            </p>
            <CommandSteps
              steps={[
                {
                  command: HUB_UPDATE_COMMAND,
                  note: "Run this in your Beacon folder. Your database and accounts remain untouched.",
                },
              ]}
            />
          </div>
          <DialogFooter>
            {latest?.url ? (
              <Button variant="secondary" asChild>
                <a href={latest.url} target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4" />
                  Read the release notes
                </a>
              </Button>
            ) : null}
            <Button variant="primary" onClick={closeUpdate}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
