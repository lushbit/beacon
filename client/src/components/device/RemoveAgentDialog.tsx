import { useState } from "react";
import { Apple, Container, MonitorSmartphone, Terminal } from "lucide-react";
import { CommandSteps, type Step } from "@/components/CommandSteps";
import { SelfSignedToggle } from "@/components/SelfSignedToggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { shellScriptDownload, windowsScriptCommand } from "@/lib/installCommands";

/** Opens on the tab for the system the agent reported. */
function tabFor(platform: string): string {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/**
 * Shown after a device is removed from the dashboard. That only deletes it on
 * the hub, so the agent stays installed on the device until one of these
 * commands takes it off.
 */
export function RemoveAgentDialog({
  open,
  deviceName,
  platform,
  onClose,
}: {
  open: boolean;
  deviceName: string;
  platform: string;
  onClose: () => void;
}) {
  const [insecure, setInsecure] = useState(false);
  const hubUrl = `${window.location.protocol}//${window.location.host}`;
  const shell = shellScriptDownload(hubUrl, insecure);

  const commands: Record<string, Step[]> = {
    linux: [
      {
        command: `${shell} | sudo sh -s -- --uninstall`,
        note: "Stops the service and deletes the agent. Leave out sudo if the agent was installed without it.",
      },
    ],
    macos: [
      {
        command: `${shell} | sh -s -- --uninstall`,
        note: "Unloads the launchd agent and deletes it.",
      },
    ],
    windows: [
      {
        command: windowsScriptCommand(hubUrl, "-Uninstall", insecure),
        note: "Approve the administrator prompt. Removes the service and deletes the agent.",
      },
    ],
    docker: [
      { title: "Remove the container", command: "docker rm -f beacon-agent" },
      {
        title: "Delete its data and image",
        command: "docker volume rm beacon-agent-data && docker image rm beacon-agent",
        note: "Prefix both commands with sudo unless your user is in the docker group.",
      },
    ],
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title={`${deviceName} was removed`}
          description="The agent is still installed on the device. Run the command for its system to remove it there too."
        />

        <div className="space-y-4">
          <Tabs defaultValue={tabFor(platform)} className="space-y-3">
            <TabsList className="w-full">
              <TabsTrigger value="linux">
                <Terminal className="mr-1.5 inline h-3.5 w-3.5" />
                Linux
              </TabsTrigger>
              <TabsTrigger value="macos">
                <Apple className="mr-1.5 inline h-3.5 w-3.5" />
                macOS
              </TabsTrigger>
              <TabsTrigger value="windows">
                <MonitorSmartphone className="mr-1.5 inline h-3.5 w-3.5" />
                Windows
              </TabsTrigger>
              <TabsTrigger value="docker">
                <Container className="mr-1.5 inline h-3.5 w-3.5" />
                Docker
              </TabsTrigger>
            </TabsList>

            <TabsContent value="linux">
              <CommandSteps steps={commands.linux} />
            </TabsContent>

            <TabsContent value="macos">
              <CommandSteps steps={commands.macos} />
            </TabsContent>

            <TabsContent value="windows">
              <CommandSteps steps={commands.windows} />
            </TabsContent>

            <TabsContent value="docker">
              <CommandSteps steps={commands.docker} />
            </TabsContent>
          </Tabs>

          <SelfSignedToggle checked={insecure} onCheckedChange={setInsecure} />
        </div>

        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
