import { useState } from "react";
import { RadioTower } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export function SetupPage() {
  const { refresh } = useAuth();
  const [siteName, setSiteName] = useState("Beacon");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setup({ username, password, siteName });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete setup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-inset ring-white/10">
            <RadioTower className="h-5 w-5 text-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Welcome to Beacon</h1>
            <p className="text-sm text-muted-foreground">Create the first administrator account.</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border/70 bg-card p-5">
          <Field label="Dashboard name" htmlFor="site">
            <Input id="site" value={siteName} onChange={(event) => setSiteName(event.target.value)} required />
          </Field>
          <Field label="Username" htmlFor="username">
            <Input
              id="username"
              value={username}
              autoComplete="username"
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters.">
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="new-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm">
            <Input
              id="confirm"
              type="password"
              value={confirm}
              autoComplete="new-password"
              required
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>

          {error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
