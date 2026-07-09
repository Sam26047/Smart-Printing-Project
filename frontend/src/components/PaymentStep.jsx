// frontend/src/components/PaymentStep.jsx
// Reusable checkout step for a PENDING + UNPAID (or FAILED) job.
//
// State machine: idle → creating → modal → confirming → confirmed | slow
//   idle       "Pay ₹X" button (FAILED payment renders it as a retry)
//   creating   order endpoint call + checkout.js load in flight
//   modal      Razorpay Checkout open; ondismiss returns to idle
//   confirming checkout success handler fired — OPTIMISTIC ONLY. State is
//              webhook-authoritative: we poll the job until the verified
//              webhook flips it to QUEUED/PAID. Nothing is written client-side.
//   confirmed  server confirmed the payment (poll saw PAID/QUEUED)
//   slow       poll cap (60s) hit — webhook delayed; tell the student to
//              refresh later rather than spinning forever.

import { useEffect, useRef, useState } from "react";
import printJobService from "../services/printJobs";
import loadRazorpay from "../utils/loadRazorpay";
import { useAuth } from "../hooks/useAuth";

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 60000;

export default function PaymentStep({ jobId, amount, paymentStatus = "UNPAID", onConfirmed }) {
  const { user } = useAuth();
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  // Never leave a poll running after unmount
  useEffect(() => () => clearInterval(pollRef.current), []);

  const startConfirmationPoll = () => {
    setPhase("confirming");
    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      try {
        const res = await printJobService.getJobById(jobId);
        const job = res.data;
        // The webhook is what flips these — seeing either means it landed
        if (job.payment_status === "PAID" || job.status === "QUEUED") {
          clearInterval(pollRef.current);
          setPhase("confirmed");
          onConfirmed?.(job);
          return;
        }
      } catch {
        // transient fetch error — keep polling until the cap
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current);
        setPhase("slow");
      }
    }, POLL_MS);
  };

  const handlePay = async () => {
    setError(null);
    setPhase("creating");

    try {
      // Server reads the locked estimated_cost and owns the key — everything
      // that configures the modal comes from this response.
      const orderRes = await printJobService.createPaymentOrder(jobId);
      const { order_id, amount: amountPaise, currency, key_id } = orderRes.data;

      const Razorpay = await loadRazorpay();

      const rzp = new Razorpay({
        key: key_id,
        order_id,
        amount: amountPaise,
        currency,
        name: "PrintFlow",
        description: `print job ${jobId.slice(0, 8)}`,
        prefill: {
          name: user?.username || "",
          email: user?.email || "",
        },
        theme: { color: "#b45309" }, // --amber-dark
        // OPTIMISTIC ONLY — proof of payment is the verified webhook
        handler: () => startConfirmationPoll(),
        modal: {
          // Student closed the modal without paying → back to the pay button.
          // Guarded so a dismiss after the success handler can't clobber
          // the confirming/confirmed state.
          ondismiss: () =>
            setPhase((p) => (p === "modal" || p === "creating" ? "idle" : p)),
        },
      });

      rzp.on("payment.failed", (resp) => {
        setError(resp?.error?.description || "Payment failed — you can retry.");
        setPhase("idle");
      });

      setPhase("modal");
      rzp.open();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not start payment");
      setPhase("idle");
    }
  };

  // ── Render per phase ────────────────────────────────────────────────────
  if (phase === "confirmed") {
    return (
      <div className="mono-sm" style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
        ✓ payment confirmed — job queued
      </div>
    );
  }

  if (phase === "confirming") {
    return (
      <div className="loading-text" style={{ margin: 0 }}>
        payment received, confirming…
      </div>
    );
  }

  if (phase === "slow") {
    return (
      <div className="deadline-warn">
        <span>⏳</span>
        <span>
          taking longer than expected — your payment may still be processing.
          Check back in a minute (this page won't lose it).
        </span>
      </div>
    );
  }

  const busy = phase === "creating" || phase === "modal";
  const isRetry = paymentStatus === "FAILED";

  return (
    <div>
      {isRetry && !error && (
        <div className="alert alert-error" style={{ marginBottom: 8 }}>
          Previous payment failed — you can retry below.
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={handlePay}
      >
        {busy
          ? "starting payment…"
          : `${isRetry ? "retry payment" : "pay"}${amount != null ? ` ₹${Number(amount)}` : ""} →`}
      </button>
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
