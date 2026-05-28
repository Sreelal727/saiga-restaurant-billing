"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { Plus, Pencil, Trash2, KeyRound, ShieldCheck, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Role = "waiter" | "manager" | "cashier";

type StaffMember = {
  _id: Id<"restaurant_staff">;
  name: string;
  role: Role;
  phone?: string;
  is_active: boolean;
  username?: string;
  pin?: string;
};

const ROLE_STYLE: Record<Role, string> = {
  manager: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  cashier: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  waiter: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const EMPTY_FORM = { name: "", role: "waiter" as Role, phone: "" };

function suggestUsername(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
}

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function StaffPage() {
  const staff = useQuery(api.staff.list, {}) as StaffMember[] | undefined;
  const createStaff = useMutation(api.staff.create);
  const updateStaff = useMutation(api.staff.update);
  const removeStaff = useMutation(api.staff.remove);
  const setStaffLogin = useMutation(api.auth.setStaffLogin);
  const clearStaffLogin = useMutation(api.auth.clearStaffLogin);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<Id<"restaurant_staff"> | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // PIN credential modal state
  const [pinFor, setPinFor] = useState<StaffMember | null>(null);
  const [pinUsername, setPinUsername] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  function openPin(member: StaffMember) {
    setPinFor(member);
    setPinUsername(member.username ?? suggestUsername(member.name));
    setPinValue(member.pin ?? randomPin());
  }

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinFor) return;
    if (!/^\d{4}$/.test(pinValue)) {
      toast.error("PIN must be exactly 4 digits");
      return;
    }
    setPinBusy(true);
    try {
      await setStaffLogin({
        id: pinFor._id,
        username: pinUsername,
        pin: pinValue,
      });
      toast.success(`Login set for ${pinFor.name}`);
      setPinFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set login");
    } finally {
      setPinBusy(false);
    }
  }

  async function handleClearPin(member: StaffMember) {
    if (!confirm(`Revoke login for ${member.name}?`)) return;
    try {
      await clearStaffLogin({ id: member._id });
      toast.success("Login revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    }
  }

  function openNew() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(member: StaffMember) {
    setEditId(member._id);
    setForm({ name: member.name, role: member.role, phone: member.phone ?? "" });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editId) {
        await updateStaff({
          id: editId,
          name: form.name.trim(),
          role: form.role,
          phone: form.phone || undefined,
        });
        toast.success("Staff updated");
      } else {
        await createStaff({
          name: form.name.trim(),
          role: form.role,
          phone: form.phone || undefined,
        });
        toast.success("Staff member added");
      }
      setShowForm(false);
    } catch {
      toast.error("Failed to save staff member");
    }
  }

  async function handleDelete(id: Id<"restaurant_staff">, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    try {
      await removeStaff({ id });
      toast.success("Staff member removed");
    } catch {
      toast.error("Failed to remove");
    }
  }

  async function handleToggle(id: Id<"restaurant_staff">, current: boolean) {
    try {
      await updateStaff({ id, is_active: !current });
    } catch {
      toast.error("Failed to update status");
    }
  }

  const addBtn = (
    <button
      onClick={openNew}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> Add Staff
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Staff" action={addBtn} />
      <div className="flex-1 p-6 space-y-4">

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-card border border-border rounded-lg p-4 max-w-sm space-y-3"
          >
            <h3 className="text-sm font-medium">
              {editId ? "Edit Staff Member" : "New Staff Member"}
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring capitalize"
              >
                <option value="waiter">Waiter</option>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Optional"
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
                {editId ? "Update" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {staff === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : staff.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">No staff members yet</div>
        ) : (
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {staff.map((member) => (
              <div
                key={member._id}
                className={cn("flex items-center gap-4 px-4 py-3", !member.is_active && "opacity-50")}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{member.name}</span>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                        ROLE_STYLE[member.role]
                      )}
                    >
                      {member.role}
                    </span>
                    {!member.is_active && (
                      <span className="text-xs text-muted-foreground">(inactive)</span>
                    )}
                  </div>
                  {(member.phone || member.username) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {member.phone && <span>{member.phone}</span>}
                      {member.phone && member.username && <span> · </span>}
                      {member.username && <span>@{member.username}</span>}
                    </p>
                  )}
                </div>

                {/* Login status / actions */}
                {member.username ? (
                  <span
                    title="This staff member has a login"
                    className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    PIN set
                    <button
                      onClick={() => openPin(member)}
                      className="ml-1 text-muted-foreground hover:text-foreground text-xs underline"
                    >
                      change
                    </button>
                    <button
                      onClick={() => handleClearPin(member)}
                      className="ml-1 text-muted-foreground hover:text-destructive text-xs underline"
                    >
                      revoke
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => openPin(member)}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-secondary hover:bg-secondary/70 text-secondary-foreground"
                  >
                    <KeyRound className="h-3 w-3" /> Set PIN
                  </button>
                )}

                <button
                  onClick={() => handleToggle(member._id, member.is_active)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {member.is_active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => openEdit(member)}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(member._id, member.name)}
                  className="p-1.5 text-muted-foreground hover:text-destructive rounded"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PIN credential modal */}
      {pinFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pinBusy && setPinFor(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSetPin}
            className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Lock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Login for {pinFor.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Share the username and PIN with them privately.
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Username
              </label>
              <input
                autoFocus
                value={pinUsername}
                onChange={(e) => setPinUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Lowercase letters, numbers, dot, underscore, dash — at least 3 chars
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                4-digit PIN
              </label>
              <div className="flex items-center gap-2">
                <input
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  value={pinValue}
                  onChange={(e) =>
                    setPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  className="flex-1 px-4 py-3 text-xl tabular-nums tracking-[0.5em] text-center rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <button
                  type="button"
                  onClick={() => setPinValue(randomPin())}
                  className="px-3 py-2 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/70"
                  title="Generate a fresh random PIN"
                >
                  Randomize
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={pinBusy}
                onClick={() => setPinFor(null)}
                className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pinBusy}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                {pinBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
