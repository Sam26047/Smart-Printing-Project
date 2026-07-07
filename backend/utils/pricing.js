// backend/utils/pricing.js
// Central place for all pricing logic.
// Keeps cost calculation out of the controller so it's easy to tune.
//
// Rates are PER SHOP now (shop_pricing table): a B&W per-page rate, a color
// per-page rate, and an optional duplex discount percentage. Paper size is
// NOT priced. The old hardcoded global RATES are gone.

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
// shopPricing: a shop_pricing row { bw_price_per_page, color_price_per_page,
// duplex_discount_pct } — pg returns NUMERIC as strings, hence Number().
export function pageRate(color, doubleSided, shopPricing) {
  let rate = color
    ? Number(shopPricing.color_price_per_page)
    : Number(shopPricing.bw_price_per_page);
  if (doubleSided) {
    rate = rate * (1 - Number(shopPricing.duplex_discount_pct) / 100);
  }
  return rate;
}

// fileSettings: array of { copies, color, double_sided, page_count }
// (page_count is the server-side pdf-lib count — authoritative, never client-sent)
// Returns { baseTotal, urgencyExtra, grandTotal, breakdown[] }
export function calculateJobCost(fileSettings, urgencyMultiplier, shopPricing) {
  let baseTotal = 0;

  const breakdown = fileSettings.map((s, i) => {
    const copies         = parseInt(s.copies)       || 1;
    const color          = Boolean(s.color);
    const doubleSided    = Boolean(s.double_sided);
    const estimatedPages = parseInt(s.page_count) || 1;
    const rate           = pageRate(color, doubleSided, shopPricing);
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