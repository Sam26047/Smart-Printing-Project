// frontend/src/components/AdminShop.jsx
// Shopkeeper settings: this shop's printers (CRUD + manual status toggle) and
// per-shop pricing. Built from the existing design tokens — card, form-*,
// btn, badge patterns. All authority stays server-side; this only displays
// and submits.
import { useEffect, useState } from "react";
import printersService from "../services/printers";
import tiersService from "../services/tiers";
import AgentTokensPanel from "./AgentTokensPanel";

const PAPER_SIZES = ["A4", "Letter", "A3"];
const STATUS_OPTIONS = ["ONLINE", "OFFLINE", "OUT_OF_SERVICE"];

// A printer may be assigned to a tier only if its hardware can produce it
// (server enforces the same rule; this just filters the assign dropdown).
const capabilityOk = (tier, p) =>
  (!tier.color || p.supports_color) && (!tier.duplex || p.supports_duplex);

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
// device_name is picked from the printers the shop's agent(s) actually report
// (GET /printers/discovered) so hand-typed spooler names — the classic
// silent-print-failure — become the exception, not the rule. Free-text entry
// stays available as the escape hatch (configuring before the agent exists).
function PrinterForm({ initial, onSave, onCancel, saving, discovered, staleAfterMin }) {
  const [form, setForm] = useState(initial);
  // null = auto (manual only if editing a name no agent reports)
  const [manualChoice, setManualChoice] = useState(null);
  // freshness snapshot taken when the form mounts — discovered data refetches
  // on every form open, so a per-mount timestamp is accurate enough
  const [now] = useState(() => Date.now());

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Dedupe by name: one option per unique device_name, ALL reporter labels
  // joined, freshness = the most recent report from ANY machine.
  const byName = new Map();
  for (const d of discovered) {
    const e = byName.get(d.device_name) || { labels: [], lastSeen: 0 };
    const label = d.agent_label || "unlabelled agent";
    if (!e.labels.includes(label)) e.labels.push(label);
    e.lastSeen = Math.max(e.lastSeen, new Date(d.last_seen_at).getTime());
    byName.set(d.device_name, e);
  }
  const staleCutoff = now - (staleAfterMin || 30) * 60 * 1000;
  const entries = [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const freshEntries = entries.filter(([, e]) => e.lastSeen >= staleCutoff);
  const staleEntries = entries.filter(([, e]) => e.lastSeen < staleCutoff);

  const noDiscovered = entries.length === 0;
  const autoManual = initial.device_name !== "" && !byName.has(initial.device_name);
  const manual = noDiscovered || (manualChoice ?? autoManual);

  const optionText = ([name, e]) => `${name} — via ${e.labels.join(" + ")}`;

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

          {noDiscovered && (
            <div className="deadline-warn" style={{ marginBottom: 8 }}>
              <span>🔌</span>
              <span>
                The print agent hasn't reported any printers yet — start the agent on
                the shop PC (check its token) and this list fills automatically.
                Until then you can type the exact Windows printer name below.
              </span>
            </div>
          )}

          {manual ? (
            <input
              className="form-input"
              type="text"
              placeholder="exact name from Devices and Printers"
              value={form.device_name}
              onChange={(e) => set("device_name", e.target.value)}
            />
          ) : (
            <select
              className="form-select"
              value={byName.has(form.device_name) ? form.device_name : ""}
              onChange={(e) => set("device_name", e.target.value)}
            >
              <option value="">choose a discovered printer…</option>
              {freshEntries.length > 0 && (
                <optgroup label="reported by your agent">
                  {freshEntries.map((en) => (
                    <option key={en[0]} value={en[0]}>{optionText(en)}</option>
                  ))}
                </optgroup>
              )}
              {staleEntries.length > 0 && (
                <optgroup label={`not seen in ${staleAfterMin || 30}+ min`}>
                  {staleEntries.map((en) => (
                    <option key={en[0]} value={en[0]}>{optionText(en)}</option>
                  ))}
                </optgroup>
              )}
            </select>
          )}

          {!noDiscovered && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 6 }}
              onClick={() => setManualChoice(!manual)}
            >
              {manual ? "← choose from discovered printers" : "enter device name manually"}
            </button>
          )}
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

  // Agent-reported spooler names (dropdown options for the form)
  const [discovered, setDiscovered]       = useState([]);
  const [staleAfterMin, setStaleAfterMin] = useState(30);

  // Capability tiers: price editing + printer assignment + live availability.
  // priceDrafts holds the in-progress price input per tier (strings).
  const [tiers, setTiers]           = useState([]);
  const [priceDrafts, setPriceDrafts] = useState({});
  const [tierNotice, setTierNotice] = useState(null);
  const [tierError, setTierError]   = useState(null);

  const fetchPrinters = () => {
    printersService.listPrinters()
      .then((res) => setPrinters(res.data.printers || []))
      .catch(() => setError("Failed to load printers"));
  };

  const fetchDiscovered = () => {
    printersService.getDiscovered()
      .then((res) => {
        setDiscovered(res.data.discovered || []);
        if (res.data.stale_after_minutes) setStaleAfterMin(res.data.stale_after_minutes);
      })
      .catch(() => { /* non-critical — the form falls back to manual entry */ });
  };

  const fetchTiers = () => {
    tiersService.getAdminTiers()
      .then((res) => {
        const list = res.data.tiers || [];
        setTiers(list);
        setPriceDrafts(Object.fromEntries(list.map((t) => [t.id, String(t.price_per_page)])));
      })
      .catch(() => { /* non-critical — panel just won't populate */ });
  };

  useEffect(() => {
    fetchPrinters();
    fetchTiers();
    fetchDiscovered();
  }, []);

  // Refresh the dropdown options whenever the add/edit form opens — a newly
  // reported printer should be pickable without a page reload
  useEffect(() => {
    if (editingId !== null) fetchDiscovered();
  }, [editingId]);

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

  // ── tier actions ─────────────────────────────────────────────────────────
  const handleSaveTierPrice = async (t) => {
    setTierError(null); setTierNotice(null);
    const price = Number(priceDrafts[t.id]);
    if (!Number.isFinite(price) || price < 0) {
      setTierError("Price must be a number ≥ 0");
      return;
    }
    try {
      await tiersService.updateTier(t.id, { price_per_page: price });
      setTierNotice(`${t.name} price updated — applies to new jobs only`);
      fetchTiers();
    } catch (err) {
      setTierError(err.response?.data?.error || "Failed to update price");
    }
  };

  const handleAssign = async (printerId, tierId) => {
    setTierError(null); setTierNotice(null);
    try {
      const res = await tiersService.assignPrinter(printerId, tierId);
      const rq = res.data.requeued_jobs;
      setTierNotice(res.data.message + (rq > 0 ? ` — ${rq} blocked job${rq > 1 ? "s" : ""} re-queued` : ""));
      fetchTiers();
      fetchPrinters();
    } catch (err) {
      setTierError(err.response?.data?.error || "Failed to assign printer");
    }
  };

  const handleUnassign = async (printerId, tierId) => {
    setTierError(null); setTierNotice(null);
    try {
      await tiersService.unassignPrinter(printerId, tierId);
      fetchTiers();
    } catch (err) {
      setTierError(err.response?.data?.error || "Failed to unassign printer");
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
                  {p.discovered === false && (
                    <span
                      className="file-type-tag"
                      style={{ color: "var(--amber-dark)", borderColor: "var(--amber)" }}
                      title="No agent currently reports this device name — check for a typo, or the agent may be offline"
                    >
                      UNVERIFIED
                    </span>
                  )}
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
            discovered={discovered}
            staleAfterMin={staleAfterMin}
            saving={saving}
            onSave={handleSavePrinter}
            onCancel={() => setEditingId(null)}
          />
        )}

        {notice && <div className="alert alert-success">{notice}</div>}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {/* ── Capability tiers: pricing + printer assignment + availability ── */}
      <div className="card card-padded" style={{ marginBottom: "20px" }}>
        <div className="form-label">capability tiers &amp; pricing</div>
        <div className="mono-sm" style={{ color: "var(--gray)", marginBottom: "12px" }}>
          students pick a tier, never a device. price is per page and applies to
          new jobs only (submitted jobs keep their locked price). a tier is
          orderable only while it has an online assigned printer.
        </div>

        {tierNotice && <div className="alert alert-success" style={{ marginBottom: 10 }}>{tierNotice}</div>}
        {tierError && <div className="alert alert-error" style={{ marginBottom: 10 }}>{tierError}</div>}

        {tiers.map((t) => {
          const assignable = printers.filter(
            (p) => capabilityOk(t, p) && !t.printers.some((tp) => tp.id === p.id)
          );
          const dirty = String(priceDrafts[t.id] ?? "") !== String(t.price_per_page);
          return (
            <div key={t.id} style={{ borderTop: "0.5px solid var(--border)", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                  {t.available
                    ? <span className="badge badge-ready"><span className="badge-dot" />available</span>
                    : <span className="badge badge-pending"><span className="badge-dot" />unavailable</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="mono-sm" style={{ color: "var(--gray)" }}>₹</span>
                  <input
                    className="form-input" type="number" min="0" step="0.5"
                    style={{ width: 90 }}
                    value={priceDrafts[t.id] ?? ""}
                    onChange={(e) => setPriceDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                  />
                  <span className="mono-sm" style={{ color: "var(--gray)" }}>/pg</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!dirty}
                    onClick={() => handleSaveTierPrice(t)}
                  >
                    save
                  </button>
                </div>
              </div>

              {/* Assigned printers + assign control (never shown to students) */}
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {t.printers.length === 0 && (
                  <span className="mono-sm" style={{ color: "var(--rose-dark)" }}>no printers assigned</span>
                )}
                {t.printers.map((p) => (
                  <span key={p.id} className="file-type-tag" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {p.label} · {p.status.toLowerCase().replaceAll("_", " ")}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "0 2px", lineHeight: 1 }}
                      title={`Unassign ${p.label} from ${t.name}`}
                      onClick={() => handleUnassign(p.id, t.id)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {assignable.length > 0 && (
                  <select
                    className="file-select"
                    value=""
                    onChange={(e) => { if (e.target.value) handleAssign(e.target.value, t.id); }}
                  >
                    <option value="">+ assign printer…</option>
                    {assignable.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Print agent tokens ───────────────────────────────────────────── */}
      <AgentTokensPanel />
    </>
  );
}
