import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, a render error unmounts the whole tree and leaves a blank,
 * unresponsive page that looks identical to "the buttons stopped working".
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[beacon] render error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-border/70 bg-card p-5 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Something in the dashboard broke.</p>
            <p className="text-sm text-muted-foreground">
              The page stopped rather than leaving you with a screen that ignores taps.
            </p>
          </div>
          <pre className="scroll-slim max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 text-left text-2xs text-muted-foreground">
            {error.message}
          </pre>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              <RotateCw className="h-4 w-4" />
              Reload
            </Button>
            <Button variant="ghost" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
