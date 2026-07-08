// frontend/src/components/AdminShop.jsx
// Shopkeeper settings: this shop's printers (CRUD + manual status toggle) and
// per-shop pricing. Built from the existing design tokens — card, form-*,
// btn, badge patterns. All authority stays server-side; this only displays
// and submits.
import { useEffect, useState } from "react";
import printersService from "../services/printers";
import shopPricingService from "../services/shopPricing";

const PAPER_SIZES = ["A4", "Letter", "A3"];
const STATUS_OPTIONS = ["ONLINE", "OFFLINE", "OUT_OF_SERVICE"];

const EMPTY_PRINTER = {
  label: "",
  device_name: "",
  supports_color: false,
  supports_duplex: true,
  paper_sizes: ["A4"],
};

// Status pill — same inline-pill pattern as UrgencyBadge in AdminJobRow
function PrinterStatusPill({ status }) {
  const map = {
    ONLINE:         { label: "online",         color: "var(--teal-dark)",  bg: "var(--teal-lite)",  border: "#5eead4" },
    OFFLINE:        { label: "offline",        color: "var(--amber-dark)", bg: "var(--amber-lite)", border: "#fbbf24" },
    OUT_OF_SERVICE: { label: "out of service", color: "var(--rose-dark)",  bg: "var(--rose-lite)",  border: "#fca5a5" },
  };
  const s = map[status] || map.OFFLINE;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      fontFamily: "var(--mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.05em",
      color: s.color, background: s.bg, border: `0.5px solid ${s.border}`,
      whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

// ─── Printer add/edit form (shared) ──────────────────────────────────────────
function PrinterForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const togglePaper = (size) => {
    setForm((f) => {
      const has = f.paper_sizes.includes(size);
      // never allow zero paper sizes — server requires a non-empty array
      const next = has ? f.paper_sizes.filter((s) => s !== size) : [...f.paper_sizes, size];
      return { ...f, paper_sizes: next.length > 0 ? next : f.paper_sizes };
    });
  };

  return (
    <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: "14px", marginTop: "14px" }}>
      <div className="form-row-2">
        <div className="form-group">
          <label className="form-label">label</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Laser B&W"
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">windows device name</label>
          <input
            className="form-input"
            type="text"
            placeholder="exact name from Devices and Printers"
            value={form.device_name}
            onChange={(e) => set("device_name", e.target.value)}
          />
        </div>
      </div>

      <div className="form-row-2">
        <div className="form-group">
          <label className="form-label">type</label>
          <select
            className="form-select"
            value={form.supports_color ? "color" : "bw"}
            onChange={(e) => set("supports_color", e.target.value === "color")}
          >
            <option value="bw">B&amp;W only (laser)</option>
            <option value="color">Colour capable</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">capabilities</label>
          <div style={{ display: "flex", gap: "14px", alignItems: "center", paddingTop: "6px" }}>
            <label className="mono-sm" style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.supports_duplex}
                onChange={(e) => set("supports_duplex", e.target.checked)}
              />
              duplex
            </label>
            {PAPER_SIZES.map((size) => (
              <label key={size} className="mono-sm" style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.paper_sizes.includes(size)}
                  onChange={() => togglePaper(size)}
                />
                {size}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="btn-row">
        {onCancel && (
          <button type="button" className="btn btn-outline" onClick={onCancel}>cancel</button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !form.label.trim() || !form.device_name.trim()}
          onClick={() => onSave(form)}
        >
          {saving ? "saving…" : "save printer"}
        </button>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function AdminShop() {
  const [printers, setPrinters]   = useState([]);
  const [editingId, setEditingId] = useState(null); // printer id being edited, or "new"
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [notice, setNotice]       = useState(null);

  // Pricing form state (strings so the inputs stay controlled while typing)
  const [pricing, setPricing]           = useState({ bw: "", color: "", discount: "" });
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingError, setPricingError]   = useState(null);
  const [pricingSaved, setPricingSaved]   = useState(false);

  const fetchPrinters = () => {
    printersService.listPrinters()
      .then((res) => setPrinters(res.data.printers || []))
      .catch(() => setError("Failed to load printers"));
  };

  const fetchPricing = () => {
    shopPricingService.getPricing()
      .then((res) => {
        const p = res.data.pricing;
        setPricing({
          bw: p.bw_price_per_page,
          color: p.color_price_per_page,
          discount: p.duplex_discount_pct,
        });
      })
      .catch(() => { /* 404 = not configured yet — form starts blank */ });
  };

  useEffect(() => {
    fetchPrinters();
    fetchPricing();
  }, []);

  const clearMessages = () => { setError(null); setNotice(null); };

  // ── printer actions ──────────────────────────────────────────────────────
  const handleSavePrinter = async (form) => {
    clearMessages();
    setSaving(true);
    try {
      if (editingId === "new") {
        await printersService.createPrinter(form);
      } else {
        await printersService.updatePrinter(editingId, form);
      }
      setEditingId(null);
      fetchPrinters();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save printer");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (printer, status) => {
    clearMessages();
    try {
      const res = await printersService.updatePrinter(printer.id, { status });
      const requeued = res.data.requeued_jobs;
      if (requeued > 0) {
        setNotice(`${printer.label} is online — ${requeued} blocked job${requeued > 1 ? "s" : ""} re-queued`);
      }
      fetchPrinters();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update status");
    }
  };

  const handleDelete = async (printer) => {
    clearMessages();
    try {
      await printersService.deletePrinter(printer.id);
      fetchPrinters();
    } catch (err) {
      // 409 = bound to a job currently printing — surface the server's message
      setError(err.response?.data?.error || "Failed to delete printer");
    }
  };

  // ── pricing actions ──────────────────────────────────────────────────────
  const handleSavePricing = async () => {
    setPricingError(null);
    setPricingSaved(false);

    const bw = Number(pricing.bw);
    const color = Number(pricing.color);
    const discount = Number(pricing.discount || 0);

    // Client-side range checks only — the server re-validates and is authority
    if (!Number.isFinite(bw) || bw < 0 || !Number.isFinite(color) || color < 0) {
      setPricingError("Rates must be numbers ≥ 0");
      return;
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      setPricingError("Duplex discount must be between 0 and 100");
      return;
    }

    setPricingSaving(true);
    try {
      await shopPricingService.putPricing({
        bw_price_per_page: bw,
        color_price_per_page: color,
        duplex_discount_pct: discount,
      });
      setPricingSaved(true);
      fetchPricing();
    } catch (err) {
      setPricingError(err.response?.data?.error || "Failed to save pricing");
    } finally {
      setPricingSaving(false);
    }
  };

  return (
    <>
      {/* ── Printers ─────────────────────────────────────────────────────── */}
      <div className="card card-padded" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="form-label">printers</div>
            <div className="mono-sm" style={{ color: "var(--gray)" }}>
              jobs route per file — B&amp;W files only print on B&amp;W printers
            </div>
          </div>
          {editingId === null && (
            <button className="btn btn-outline" onClick={() => { clearMessages(); setEditingId("new"); }}>
              + add printer
            </button>
          )}
        </div>

        {printers.length === 0 && editingId === null && (
          <div className="empty-state">
            No printers yet — jobs will wait until one is added and online.
          </div>
        )}

        {printers.map((p) => (
          <div key={p.id} className="file-card">
            <div className="file-card-icon">🖨️</div>
            <div className="file-card-info">
              <div className="file-card-name">
                {p.label} <PrinterStatusPill status={p.status} />
              </div>
              <div className="file-card-meta">
                {p.device_name}
                <span style={{ marginLeft: 8 }}>
                  <span className="file-type-tag">{p.supports_color ? "COLOUR" : "B&W"}</span>
                  {p.supports_duplex && <span className="file-type-tag">DUPLEX</span>}
                  {(p.paper_sizes || []).map((s) => (
                    <span key={s} className="file-type-tag">{s}</span>
                  ))}
                </span>
              </div>
            </div>
            <div className="file-card-controls">
              <select
                className="file-select"
                value={p.status}
                onChange={(e) => handleStatusChange(p, e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.toLowerCase().replaceAll("_", " ")}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { clearMessages(); setEditingId(p.id); }}
              >
                edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Delete printer"
                onClick={() => handleDelete(p)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        {editingId !== null && (
          <PrinterForm
            initial={
              editingId === "new"
                ? EMPTY_PRINTER
                : (({ label, device_name, supports_color, supports_duplex, paper_sizes }) =>
                    ({ label, device_name, supports_color, supports_duplex, paper_sizes }))(
                    printers.find((p) => p.id === editingId)
                  )
            }
            saving={saving}
            onSave={handleSavePrinter}
            onCancel={() => setEditingId(null)}
          />
        )}

        {notice && <div className="alert alert-success">{notice}</div>}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <div className="card card-padded">
        <div className="form-label">pricing</div>
        <div className="mono-sm" style={{ color: "var(--gray)", marginBottom: "12px" }}>
          per-page rates for this shop — changes apply to new jobs only
          (submitted jobs keep their locked price)
        </div>

        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label">b&amp;w ₹/page</label>
            <input
              className="form-input" type="number" min="0" step="0.5"
              value={pricing.bw}
              onChange={(e) => setPricing((p) => ({ ...p, bw: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">colour ₹/page</label>
            <input
              className="form-input" type="number" min="0" step="0.5"
              value={pricing.color}
              onChange={(e) => setPricing((p) => ({ ...p, color: e.target.value }))}
            />
          </div>
        </div>
        <div className="form-group" style={{ maxWidth: "220px" }}>
          <label className="form-label">duplex discount %</label>
          <input
            className="form-input" type="number" min="0" max="100" step="1"
            value={pricing.discount}
            onChange={(e) => setPricing((p) => ({ ...p, discount: e.target.value }))}
          />
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pricingSaving}
            onClick={handleSavePricing}
          >
            {pricingSaving ? "saving…" : "save pricing"}
          </button>
        </div>

        {pricingSaved && <div className="alert alert-success">Pricing updated.</div>}
        {pricingError && <div className="alert alert-error">{pricingError}</div>}
      </div>
    </>
  );
}
