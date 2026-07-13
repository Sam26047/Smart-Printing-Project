# PrintFlow

Campus print-job management: students upload PDFs, pay online, and collect at
the counter; shops run the queue with per-shop printers, pricing, and a local
Windows print agent. A cloud **demo shop** with a virtual printer lets anyone
experience the full pipeline online — no login setup, no physical printer.

## Try the demo

Everything below runs the **real** pipeline (payment, routing, agent protocol) —
the only difference is that the demo shop's "printer" is a cloud worker that
stamps the PDF instead of putting ink on paper.

### Demo accounts

| Role | Username | Password |
|---|---|---|
| Customer (student) | `demo_customer` | `PrintDemo@2026` |
| Shop admin | `demo_admin` | `PrintDemo@2026` |

### Test payment values (Razorpay test mode — no real money)

- **Card:** `5267 3181 8797 5449` (domestic Mastercard — do **not** use
  4111 4111…, it fails as "international cards not supported")
- **Expiry:** any future date · **CVV:** any 3 digits
- **Phone:** any valid-format number, e.g. `9876543210`
- **Mock bank step:** test mode sends no real OTP — after the card form,
  Razorpay shows a mock bank page with **Success / Failure** buttons. Click
  **Success** to complete the payment (or **Failure** to see the failed-payment
  path with retry).

### The walkthrough

1. **Log in** as `demo_customer` / `PrintDemo@2026`.
2. **Submit a job** on the *submit job* tab: drop any PDF, pick per-file
   settings (try one B&W and one colour file — they route to different virtual
   printers), and submit. Note the **locked total** — computed server-side from
   real page counts.
3. **Pay** with the test card above (phone number + mock-bank **Success**).
   Payment confirmation is webhook-driven: the job flips to QUEUED only when
   Razorpay's signed webhook lands.
4. **Watch it print**: on *my jobs*, the job moves QUEUED → PRINTING (the
   virtual printer takes a few seconds, like a real one) → **READY**.
5. **Open the printed output**: each file now has a stamped
   `PRINTED ✓ — <timestamp>` artifact — the demo's proof of the full loop.
6. Optional: log in as `demo_admin` to see the shop side — queue, printers
   (the two virtual ones), pricing. The admin can also queue a job manually
   (the cash-at-counter path) if you'd rather skip the payment step.

> In a real shop the loop ends with an OTP emailed to the customer, entered at
> the counter to mark the job COLLECTED. That's a physical-counter step, so the
> online demo ends at READY + the stamped output.

## Stack

PERN (PostgreSQL, Express, React/Vite, Node) + Redis, Docker Compose behind
Nginx/Caddy. Razorpay (test mode) for payments; a Windows print agent
(`print-agent/`) drives physical printers over the shop-scoped agent-token
protocol; the demo shop's virtual worker (`backend/virtualAgent.js`) speaks the
same protocol.
