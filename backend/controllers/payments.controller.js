// backend/controllers/payments.controller.js
// Razorpay integration (test mode). Two invariants rule everything here:
//   1. The order amount is ALWAYS read server-side from the job's locked
//      estimated_cost — never from the client.
//   2. Payment confirmation is WEBHOOK-AUTHORITATIVE: only a signature-verified
//      payment.captured event flips PENDING → QUEUED. A client callback may
//      update UI optimistically, but never state.
// The deliberate exception: an admin's manual PENDING → QUEUED advance is the
// cash-at-counter path and leaves payment_status = 'UNPAID'.

import crypto from "crypto";
import pool from "../db/pool.js";
import config from "../config/config.js";
import razorpay from "../utils/razorpayClient.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── POST /print-jobs/:id/payment/order ───────────────────────────────────────
// JWT student endpoint. Creates (or returns the existing) Razorpay order for a
// PENDING+UNPAID job the caller owns. Amount = locked estimated_cost in paise.
export const createPaymentOrder = async (req, res) => {
  const { id: jobId } = req.params;
  if (!UUID_RE.test(jobId)) {
    return res.status(404).json({ error: "Job not found" });
  }

  try {
    const jobRes = await pool.query(
      `SELECT id, user_id, status, payment_status, estimated_cost, razorpay_order_id
       FROM print_jobs WHERE id = $1`,
      [jobId]
    );
    // Same 404 for missing and not-yours — don't leak other users' job ids
    if (jobRes.rows.length === 0 || jobRes.rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: "Job not found" });
    }
    const job = jobRes.rows[0];

    if (job.status !== "PENDING" || job.payment_status !== "UNPAID") {
      return res.status(400).json({
        error: `Job is not payable (status ${job.status}, payment ${job.payment_status})`,
      });
    }
    if (job.estimated_cost === null) {
      return res.status(400).json({ error: "Job has no locked cost" });
    }

    // Razorpay wants the smallest currency unit (paise)
    const amountPaise = Math.round(Number(job.estimated_cost) * 100);

    // Idempotent-ish: an order was already created for this job → return it
    // instead of minting a duplicate on Razorpay's side.
    if (job.razorpay_order_id) {
      return res.json({
        order_id: job.razorpay_order_id,
        amount: amountPaise,
        currency: "INR",
        key_id: config.razorpay.keyId,
        existing: true,
      });
    }

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: job.id,
    });

    await pool.query(
      `UPDATE print_jobs SET razorpay_order_id = $1 WHERE id = $2`,
      [order.id, job.id]
    );

    res.json({
      order_id: order.id,
      amount: amountPaise,
      currency: "INR",
      key_id: config.razorpay.keyId,
    });
  } catch (err) {
    console.error("CREATE PAYMENT ORDER ERROR:", err.message || err.error?.description);
    res.status(500).json({ error: "Failed to create payment order" });
  }
};

// ── POST /print-jobs/payment/webhook ─────────────────────────────────────────
// NO JWT — Razorpay calls this; the HMAC signature IS the authentication.
// Verified events always get a fast 200 (even for unknown order ids) so
// Razorpay never retries a handled delivery; ONLY a signature failure 400s.
export const paymentWebhook = async (req, res) => {
  // 1. Signature check over the EXACT wire bytes (req.rawBody, captured by the
  //    express.json verify hook in index.js) — never re-serialized JSON.
  const signature = req.headers["x-razorpay-signature"];
  if (!signature || !req.rawBody) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const expected = crypto
    .createHmac("sha256", config.razorpay.webhookSecret)
    .update(req.rawBody)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: "Invalid signature" }); // do nothing else
  }

  try {
    const event = req.body?.event;
    const entity = req.body?.payload?.payment?.entity; // { id, order_id, ... }

    if (!entity?.order_id) {
      return res.json({ received: true, ignored: true });
    }

    if (event === "payment.captured") {
      // Idempotency + status flip in ONE guarded UPDATE — atomic, so a
      // duplicate or concurrently redelivered webhook can never double-flip.
      // The CASE keeps the transition legal (PENDING → QUEUED only); a job the
      // worker already moved on stays where it is.
      const result = await pool.query(
        `UPDATE print_jobs
         SET payment_status = 'PAID',
             razorpay_payment_id = $2,
             status = CASE WHEN status = 'PENDING' THEN 'QUEUED' ELSE status END
         WHERE razorpay_order_id = $1 AND payment_status <> 'PAID'
         RETURNING id, status`,
        [entity.order_id, entity.id]
      );

      if (result.rows.length > 0) {
        console.log(`💳 Payment captured → job ${result.rows[0].id} is ${result.rows[0].status} (PAID)`);
      }
      // rowCount 0 → unknown order OR already PAID → deliberate 200 no-op
      return res.json({ received: true, processed: result.rows.length > 0 });
    }

    if (event === "payment.failed") {
      // UNPAID-only guard: an out-of-order failed-after-captured redelivery
      // can never downgrade a PAID job. The job stays PENDING either way.
      const result = await pool.query(
        `UPDATE print_jobs
         SET payment_status = 'FAILED', razorpay_payment_id = $2
         WHERE razorpay_order_id = $1 AND payment_status = 'UNPAID'
         RETURNING id`,
        [entity.order_id, entity.id]
      );
      if (result.rows.length > 0) {
        console.warn(`💳 Payment failed for job ${result.rows[0].id} (stays PENDING)`);
      }
      return res.json({ received: true, processed: result.rows.length > 0 });
    }

    // Other events: acknowledged, not our concern
    return res.json({ received: true, ignored: true });
  } catch (err) {
    console.error("PAYMENT WEBHOOK ERROR:", err.message);
    // 500 → Razorpay retries later, which is what we want on a transient DB error
    res.status(500).json({ error: "Webhook processing failed" });
  }
};
