import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, UserCog, Users as UsersIcon } from "lucide-react";
import type { UserDto, UserRole } from "@beacon/shared";
import { PageHeader } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Shared column template so the header and every row line up on desktop. */
const ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_8rem_9rem_9rem_auto]";

export function UsersPage() {
  const { session } = useAuth();
  const { attempt, notify } = useToast();
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserDto | null>(null);
  const [removing, setRemoving] = useState<UserDto | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api.users());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load users.", "error");
      setUsers([]);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const created = await attempt(
      () => api.createUser({ username: username.trim(), password, role, displayName: displayName.trim() || undefined }),
      "Account created."
    );
    if (created) {
      setCreating(false);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("viewer");
      void load();
    }
  };

  const update = async (user: UserDto, patch: { role?: UserRole; isActive?: boolean }) => {
    await attempt(() => api.updateUser(user.id, patch), "Account updated.");
    void load();
  };

  const resetPassword = async () => {
    if (!resetting) return;
    const done = await attempt(
      () => api.updateUser(resetting.id, { password: newPassword }),
      `Password reset for ${resetting.username}.`
    );
    if (done) {
      setResetting(null);
      setNewPassword("");
    }
  };

  const remove = async () => {
    if (!removing) return;
    await attempt(() => api.deleteUser(removing.id), `Removed ${removing.username}.`);
    setRemoving(null);
    void load();
  };

  return (
    <>
      <PageHeader
        title="Users"
        description={users === null ? "Loading…" : `${users.length} account${users.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New user
          </Button>
        }
      />

      <div className="p-4 sm:p-6">
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className={cn(ROW_GRID, "hidden border-b border-border/60 bg-surface-2/60 px-5 py-3 lg:grid")}>
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Role</p>
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Access</p>
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Last sign-in</p>
            <span className="sr-only">Actions</span>
          </div>

          {users === null ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No accounts yet." />
          ) : (
            <ul className="divide-y divide-border/50">
              {users.map((user) => {
                const isSelf = user.id === session?.user.id;
                return (
                  <li
                    key={user.id}
                    className={cn(
                      ROW_GRID,
                      "flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-white/[0.02]",
                      "lg:grid lg:items-center lg:gap-4"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase ring-1 ring-inset",
                          user.isActive
                            ? "bg-white/[0.08] text-foreground ring-white/15"
                            : "bg-white/[0.03] text-muted-foreground ring-white/10"
                        )}
                      >
                        {user.displayName.slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                          {user.displayName}
                          {isSelf ? (
                            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                              you
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                        <p className="truncate text-2xs text-muted-foreground/70">
                          Added {formatDateTime(user.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 lg:block">
                      <span className="shrink-0 text-xs text-muted-foreground lg:hidden">Role</span>
                      <Select
                        value={user.role}
                        onValueChange={(value) => void update(user, { role: value as UserRole })}
                      >
                        <SelectTrigger className="h-9 w-32 text-xs" aria-label={`Role for ${user.username}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between gap-3 lg:block">
                      <span className="shrink-0 text-xs text-muted-foreground lg:hidden">Access</span>
                      <span className="flex items-center gap-2.5">
                        <Switch
                          checked={user.isActive}
                          disabled={isSelf}
                          aria-label={`Account active for ${user.username}`}
                          onCheckedChange={(checked) => void update(user, { isActive: checked })}
                        />
                        <span className={cn("text-xs", user.isActive ? "text-foreground" : "text-muted-foreground")}>
                          {user.isActive ? "Active" : "Disabled"}
                        </span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 lg:block">
                      <span className="shrink-0 text-xs text-muted-foreground lg:hidden">Last sign-in</span>
                      <p className="min-w-0 truncate text-xs text-muted-foreground">
                        {user.lastLoginAt ? formatRelative(user.lastLoginAt) : "never"}
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-1 lg:justify-start">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Reset password for ${user.username}`}
                        title="Reset password"
                        onClick={() => setResetting(user)}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${user.username}`}
                        title={isSelf ? "You cannot delete your own account" : "Delete account"}
                        disabled={isSelf}
                        onClick={() => setRemoving(user)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <UserCog className="h-4 w-4 shrink-0" />
          Viewers can see every device and alert but cannot change settings, enroll devices or end processes.
        </p>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New user" description="They can sign in as soon as the account exists." />
          <div className="space-y-4">
            <Field label="Username">
              <Input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
            </Field>
            <Field label="Display name" hint="Optional — defaults to the username.">
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label="Password" hint="At least 10 characters.">
              <Input
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Role">
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()}>
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent>
          <DialogHeader
            title={`Reset password for ${resetting?.username ?? ""}`}
            description="Their existing sessions are signed out immediately."
          />
          <Field label="New password" hint="At least 10 characters.">
            <Input
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetting(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void resetPassword()}>
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader
            title={`Delete ${removing?.username ?? ""}?`}
            description="The account and its sessions are removed. This cannot be undone."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
