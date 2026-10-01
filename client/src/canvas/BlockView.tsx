import { Component, type ReactNode } from "react";
import type { CanvasBlock } from "@beacon/shared";
import { ContainersBlock, CoresBlock, InfoBlock, StatusBlock, VolumesBlock } from "./blocks/DeviceBlocks";
import { AlertsBlock, DevicesBlock, UptimeBlock } from "./blocks/FleetBlocks";
import { ClockBlock, DividerBlock, HeadingBlock, SpacerBlock, TextBlock } from "./blocks/LayoutBlocks";
import { ChartBlock, GaugeBlock, ValueBlock } from "./blocks/MetricBlocks";

/** One broken block shows a note instead of taking the whole page down with it. */
class BlockBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  override state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          This block could not be shown.
        </div>
      );
    }
    return this.props.children;
  }
}

function render(block: CanvasBlock): ReactNode {
  switch (block.type) {
    case "heading":
      return <HeadingBlock block={block} />;
    case "text":
      return <TextBlock block={block} />;
    case "divider":
      return <DividerBlock block={block} />;
    case "spacer":
      return <SpacerBlock />;
    case "chart":
      return <ChartBlock block={block} />;
    case "value":
      return <ValueBlock block={block} />;
    case "gauge":
      return <GaugeBlock block={block} />;
    case "status":
      return <StatusBlock block={block} />;
    case "info":
      return <InfoBlock block={block} />;
    case "volumes":
      return <VolumesBlock block={block} />;
    case "containers":
      return <ContainersBlock block={block} />;
    case "cores":
      return <CoresBlock block={block} />;
    case "devices":
      return <DevicesBlock block={block} />;
    case "uptime":
      return <UptimeBlock block={block} />;
    case "alerts":
      return <AlertsBlock block={block} />;
    case "clock":
      return <ClockBlock block={block} />;
  }
}

export function BlockView({ block }: { block: CanvasBlock }) {
  return <BlockBoundary resetKey={JSON.stringify(block.config)}>{render(block)}</BlockBoundary>;
}
