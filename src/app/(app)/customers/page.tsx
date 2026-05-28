"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, Search, X, Phone, Mail, MapPin } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  default_address: string;
  notes: string;
};

const EMPTY_FORM: CustomerForm = {
  name: "",
  phone: "",
  email: "",
  default_address: "",
  notes: "",
};

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const customers = useQuery(api.customers.listWithStats, {
    search: search.trim() || undefined,
  });
  const create = useMutation(api.customers.create);
  const update = useMutation(api.customers.update);
  const remove = useMutation(api.customers.remove);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<Id<"restaurant_customers"> | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);

  function openNew() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(c: {
    _id: Id<"restaurant_customers">;
    name: string;
    phone: string;
    email?: string;
    default_address?: string;
    notes?: string;
  }) {
    setEditId(c._id);
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email ?? "",
      default_address: c.default_address ?? "",
      notes: c.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    try {
      if (editId) {
        await update({
          id: editId,
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          default_address: form.default_address || undefined,
          notes: form.notes || undefined,
        });
        toast.success("Customer updated");
      } else {
        await create({
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          default_address: form.default_address || undefined,
          notes: form.notes || undefined,
        });
        toast.success("Customer added");
      }
      setShowForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function handleDelete(
    id: Id<"restaurant_customers">,
    name: string
  ) {
    if (!confirm(`Delete customer "${name}"?`)) return;
    try {
      await remove({ id });
      toast.success("Customer removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  const addBtn = (
    <button
      onClick={openNew}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> Add Customer
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Customers" action={addBtn} />

      <div className="flex-1 p-6 space-y-4">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or email…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-card border border-border rounded-lg p-4 max-w-lg grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            <h3 className="font-medium text-sm sm:col-span-2">
              {editId ? "Edit Customer" : "New Customer"}
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
              <label className="text-xs text-muted-foreground block mb-1">Phone *</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">
                Default delivery address
              </label>
              <input
                value={form.default_address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, default_address: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
              >
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

        {/* List */}
        {customers === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">
            {search
              ? `No customers matching "${search}"`
              : "No customers yet — they'll be auto-added when you take an order with a phone."}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Phone
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    Orders
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    Spent
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c._id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${c._id}`}
                        className="font-medium hover:text-primary"
                      >
                        {c.name}
                      </Link>
                      {c.default_address && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate max-w-[280px]">
                            {c.default_address}
                          </span>
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3" />
                        {c.phone}
                      </div>
                      {c.email && (
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.order_count}
                      <p className="text-xs text-muted-foreground">
                        {c.paid_order_count} paid
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {formatCurrency(c.total_spent)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() =>
                            openEdit({
                              _id: c._id,
                              name: c.name,
                              phone: c.phone,
                              email: c.email,
                              default_address: c.default_address,
                              notes: c.notes,
                            })
                          }
                          className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(c._id, c.name)}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
