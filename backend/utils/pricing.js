// backend/utils/pricing.js
// Central place for all pricing logic.
// Keeps cost calculation out of the controller so it's easy to tune.

// ─── Base rates (₹ per page) ────────────────────────────────────────────────
export const RATES = {
  BW_SINGLE: 1,       // B&W, single-sided
  BW_DOUBLE: 0.8,     // B&W, double-sided (slight discount per sheet)
  COLOR_SINGLE: 5,    // Color, single-sided
  COLOR_DOUBLE: 4,    // Color, double-sided
};

// ─── Urgency multipliers (dynamic — depend on queue size) ───────────────────
// Queue thresholds that trigger higher urgency pricing
const QUEUE_LARGE_THRESHOLD = 5;  // jobs in QUEUED state → "busy"
const QUEUE_PEAK_THRESHOLD  = 10; // jobs in QUEUED state → urgent disabled

// Returns the multiplier for a given urgency level and current queue size
// e.g. URGENT + large queue → 1.8  (i.e. +80%)
export function getUrgencyMultiplier(urgencyLevel, queueSize) {
  switch (urgencyLevel) {
    case "SOON":
      return 1.2; // flat +20% regardless of queue
    case "URGENT":
      // Dynamic: busier queue = higher cost
      if (queueSize >= QUEUE_LARGE_THRESHOLD) return 1.8; // +80%
      return 1.5;                                          // +50%
    case "NORMAL":
    default:
      return 1.0; // no extra
  }
}

// Returns true if urgent orders should be blocked due to peak load
export function isUrgentDisabled(queueSize) {
  return queueSize >= QUEUE_PEAK_THRESHOLD;
}

// ─── Per-file cost (before urgency) ─────────────────────────────────────────
// estimatedPages: we store 1 as placeholder until PDF.js page-count lands in Phase 4
function pageRate(color, doubleSided) {
  if (color)  return doubleSided ? RATES.COLOR_DOUBLE  : RATES.COLOR_SINGLE;
  return              doubleSided ? RATES.BW_DOUBLE    : RATES.BW_SINGLE;
}

// fileSettings: array of { copies, color, double_sided, estimated_pages? }
// Returns { baseTotal, urgencyExtra, grandTotal, breakdown[] }
export function calculateJobCost(fileSettings, urgencyMultiplier) {
  let baseTotal = 0;

  const breakdown = fileSettings.map((s, i) => {
    const copies         = parseInt(s.copies)       || 1;
    const color          = Boolean(s.color);
    const doubleSided    = Boolean(s.double_sided);
    const estimatedPages = parseInt(s.estimated_pages) || 1; // Phase 4 will supply real count
    const rate           = pageRate(color, doubleSided);
    const fileCost       = rate * estimatedPages * copies;

    baseTotal += fileCost;

    return {
      file_index:      i,
      copies,
      color,
      double_sided:    doubleSided,
      estimated_pages: estimatedPages,
      rate_per_page:   rate,
      file_cost:       fileCost,
    };
  });

  // Urgency surcharge is applied on top of the base total
  const grandTotal   = Math.ceil(baseTotal * urgencyMultiplier); // round up to nearest ₹
  const urgencyExtra = grandTotal - baseTotal;

  return { baseTotal, urgencyExtra, grandTotal, breakdown };
}

// ─── Abuse protection constants ──────────────────────────────────────────────
// These are checked in the controller; kept here so they're easy to change
export const URGENT_DAILY_LIMIT   = 2;    // max urgent jobs per user per 24 h
export const URGENT_COOLDOWN_MS   = 60 * 60 * 1000; // 1 hour cooldown between urgent jobs