// frontend/src/components/AgentTokensPanel.jsx
// Print-agent token management for the admin's own shop: list, mint, revoke.
//
// ONE-TIME REVEAL CONTRACT: the plaintext token exists only in the `reveal`
// state, populated solely from the mint response. It is cleared by the
// modal's close button, and destroyed on unmount (App.jsx conditionally
// renders the tab, so switching tabs unmounts this component). No useEffect
// reads or writes it, nothing copies it anywhere, and the list endpoint
// returns no secret material — there is no path that can re-show it.
import { useEffect, useState } from "react";
import agentTokensService from "../services/agentTokens";

// Same inline-pill idiom as PrinterStatusPill / UrgencyBadge
function TokenStatePill({ revoked }) {
  const s = revoked
    ? { label: "revoked", color: "var(--gray)",      bg: "var(--gray-lite)", border: "#d1d5db" }
    : { label: "active",  color: "var(--teal-dark)", bg: "var(--teal-lite)", border: "#5eead4" };
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

function fmt(ts) {
  if (!ts) return "never";
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function AgentTokensPanel() {
  const [tokens, setTokens]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [notice, setNotice]   = useState(null);

  const [mintLabel, setMintLabel] = useState("");
  const [minting, setMinting]     = useState(false);

  const [reveal, setReveal]   = useState(null); // { token, label } — see contract above
  const [copied, setCopied]   = useState(false);

  const [confirmRevoke, setConfirmRevoke] = useState(null); // token id
  const [revoking, setRevoking]           = useState(false);

  const fetchTokens = () => {
    agentTokensService.listTokens()
      .then((res) => setTokens(res.data.tokens || []))
      .catch(() => setError("Failed to load agent tokens"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTokens(); }, []);

  const activeTokens = tokens.filter((t) => !t.revoked_at);

  const handleMint = async () => {
    setError(null); setNotice(null);
    if (!mintLabel.trim()) {
      setError("Give the token a label (e.g. the machine it will run on)");
      return;
    }
    setMinting(true);
    try {
      const res = await agentTokensService.mintToken(mintLabel.trim());
      setReveal({ token: res.data.token, label: res.data.label });
      setCopied(false);
      setMintLabel("");
      fetchTokens();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to mint token");
    } finally {
      setMinting(false);
    }
  };

  const handleRevoke = async (tokenId) => {
    setError(null); setNotice(null);
    setRevoking(true);
    try {
      await agentTokensService.revokeToken(tokenId);
      setNotice("Token revoked — the agent using it will be rejected on its next poll.");
      setConfirmRevoke(null);
      fetchTokens();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to revoke token");
    } finally {
      setRevoking(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard?.writeText(reveal.token)
      .then(() => setCopied(true))
      .catch(() => {}); // clipboard unavailable — token is selectable text
  };

  const closeReveal = () => { setReveal(null); setCopied(false); };

  return (
    <div className="card card-padded" style={{ marginBottom: "20px" }}>
      <div className="form-label">print agent</div>
      <div className="mono-sm" style={{ color: "var(--gray)", marginBottom: "12px" }}>
        device tokens the print agent uses to authenticate — one per machine.
        the secret is shown once at minting and only its hash is stored.
      </div>

      {loading && <p className="loading-text">Loading tokens…</p>}

      {!loading && tokens.length === 0 && (
        <div className="empty-state">
          No tokens yet — mint one below and put it in the agent's .env as AGENT_TOKEN.
        </div>
      )}

      {!loading && tokens.length > 0 && (
        <div className="queue-table-wrap" style={{ marginBottom: "14px" }}>
          <table className="queue-table">
            <thead>
              <tr>
                <th>label</th>
                <th>created</th>
                <th>last used</th>
                <th>status</th>
                <th>action</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const isLastActive = !t.revoked_at && activeTokens.length === 1;
                return (
                  <tr key={t.id}>
                    <td style={{ fontSize: 13, fontWeight: 500 }}>{t.label || "—"}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>{fmt(t.created_at)}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>{fmt(t.last_used_at)}</td>
                    <td><TokenStatePill revoked={!!t.revoked_at} /></td>
                    <td>
                      {t.revoked_at ? (
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)", opacity: 0.6 }}>—</span>
                      ) : confirmRevoke === t.id ? (
                        <div className="deadline-warn" style={{ margin: 0, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          <span>{isLastActive ? "🛑" : "⚠️"}</span>
                          <span>
                            {isLastActive
                              ? "This is your shop's ONLY active token — the print agent will stop working until a new token is minted and installed. Revoke anyway?"
                              : "Revoke this token? The agent using it will be rejected immediately."}
                          </span>
                          <button
                            type="button"
                            className="btn btn-dark btn-sm"
                            disabled={revoking}
                            onClick={() => handleRevoke(t.id)}
                          >
                            {revoking ? "…" : "yes, revoke"}
                          </button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmRevoke(null)}>
                            cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setNotice(null); setError(null); setConfirmRevoke(t.id); }}
                        >
                          revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* mint row */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="form-group" style={{ margin: 0, flex: "1 1 220px" }}>
          <label className="form-label">new token label</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Front desk PC"
            value={mintLabel}
            onChange={(e) => setMintLabel(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={minting} onClick={handleMint}>
          {minting ? "minting…" : "mint token"}
        </button>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* ── one-time reveal modal ─────────────────────────────────────────── */}
      {reveal && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 5000,
            background: "rgba(13,17,23,0.62)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div className="card card-padded" style={{ maxWidth: 520, width: "100%" }}>
            <div className="form-label">agent token · {reveal.label || "unlabelled"}</div>
            <div className="mono-sm" style={{ color: "var(--gray-dark)", margin: "6px 0 10px" }}>
              Put this in the agent's <b>.env</b> as <b>AGENT_TOKEN</b>, then restart the agent.
            </div>
            <div
              style={{
                fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.5,
                background: "var(--paper3)", border: "1px solid var(--border-2)",
                borderRadius: "var(--r)", padding: "10px 12px",
                wordBreak: "break-all", userSelect: "all", marginBottom: 10,
              }}
            >
              {reveal.token}
            </div>
            <div className="deadline-warn" style={{ marginBottom: 12 }}>
              <span>🔐</span>
              <span>
                This is the only time this token will ever be shown — only its hash is
                stored. If you lose it, mint a new one and revoke this one.
              </span>
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn-outline" onClick={copyToken}>
                {copied ? "copied ✓" : "copy token"}
              </button>
              <button type="button" className="btn btn-primary" onClick={closeReveal}>
                I've stored it — close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
