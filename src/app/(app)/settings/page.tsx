"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Header } from "@/components/layout/header";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function SettingsPage() {
  const settings = useQuery(api.settings.get);
  const upsertSettings = useMutation(api.settings.upsert);

  const [form, setForm] = useState({
    restaurant_name: "",
    address: "",
    phone: "",
    cgst_rate: "2.5",
    sgst_rate: "2.5",
    default_packing_charge: "30",
    default_delivery_charge: "50",
    currency: "₹",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      restaurant_name: settings.restaurant_name,
      address: settings.address ?? "",
      phone: settings.phone ?? "",
      cgst_rate: String(settings.cgst_rate),
      sgst_rate: String(settings.sgst_rate),
      default_packing_charge: String(settings.default_packing_charge),
      default_delivery_charge: String(settings.default_delivery_charge),
      currency: settings.currency,
    });
  }, [settings]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertSettings({
        restaurant_name: form.restaurant_name,
        address: form.address || undefined,
        phone: form.phone || undefined,
        cgst_rate: Number(form.cgst_rate),
        sgst_rate: Number(form.sgst_rate),
        default_packing_charge: Number(form.default_packing_charge),
        default_delivery_charge: Number(form.default_delivery_charge),
        currency: form.currency,
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Settings" />
      <div className="flex-1 p-6 max-w-2xl space-y-6">

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold text-sm">Restaurant Details</h2>

          <Field label="Restaurant Name *">
            <input
              required
              value={form.restaurant_name}
              onChange={(e) => setForm((f) => ({ ...f, restaurant_name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Address">
            <textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </Field>

          <Field label="Phone">
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium mb-3">Tax Rates (GST)</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="CGST %">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.cgst_rate}
                  onChange={(e) => setForm((f) => ({ ...f, cgst_rate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="SGST %">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.sgst_rate}
                  onChange={(e) => setForm((f) => ({ ...f, sgst_rate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium mb-3">Default Charges</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Packing Charge (₹)">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.default_packing_charge}
                  onChange={(e) => setForm((f) => ({ ...f, default_packing_charge: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Delivery Charge (₹)">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.default_delivery_charge}
                  onChange={(e) => setForm((f) => ({ ...f, default_delivery_charge: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <Field label="Currency Symbol">
              <input
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-24 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
