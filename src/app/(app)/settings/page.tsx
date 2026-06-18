"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Header } from "@/components/layout/header";
import { useTenant } from "@/components/outlet/outlet-context";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function SettingsPage() {
  const tenant = useTenant();
  const settings = useQuery(api.settings.get, tenant.args ?? "skip");
  const upsertSettings = useMutation(api.settings.upsert);

  const [form, setForm] = useState({
    restaurant_name: "",
    address: "",
    phone: "",
    default_packing_charge: "30",
    default_delivery_charge: "50",
    currency: "₹",
    bill_paper_width: "80",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      restaurant_name: settings.restaurant_name,
      address: settings.address ?? "",
      phone: settings.phone ?? "",
      default_packing_charge: String(settings.default_packing_charge),
      default_delivery_charge: String(settings.default_delivery_charge),
      currency: settings.currency,
      bill_paper_width: String(settings.bill_paper_width ?? 80),
    });
  }, [settings]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    setSaving(true);
    try {
      await upsertSettings({
        ...tenant.args,
        restaurant_name: form.restaurant_name,
        address: form.address || undefined,
        phone: form.phone || undefined,
        cgst_rate: 0,
        sgst_rate: 0,
        default_packing_charge: Number(form.default_packing_charge),
        default_delivery_charge: Number(form.default_delivery_charge),
        currency: form.currency,
        bill_paper_width: Number(form.bill_paper_width),
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

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium mb-3">Bill Printing</h3>
            <Field label="Thermal paper width">
              <select
                value={form.bill_paper_width}
                onChange={(e) => setForm((f) => ({ ...f, bill_paper_width: e.target.value }))}
                className="w-40 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="80">80 mm (standard)</option>
                <option value="58">58 mm (compact)</option>
              </select>
            </Field>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Sets the receipt width for your thermal bill printer. If the print
              gets cut off on the right, switch to 58 mm. For one-tap printing
              with no dialog, see the printer setup guide.
            </p>
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
