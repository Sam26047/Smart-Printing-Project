// frontend/src/content/demoTour.js
// Pure content for the (future) guided demo tour — NO UI here. A later prompt
// wires a highlight-step/shadow-rest overlay against exactly this data, so all
// baked-in demo values live in one place. Keep in sync with README "Try the
// demo" and the seeded accounts in backend/db/init.sql.

export const DEMO_CREDENTIALS = {
  customer: { username: "demo_customer", password: "PrintDemo@2026" },
  admin:    { username: "demo_admin",    password: "PrintDemo@2026" },
};

export const DEMO_TEST_PAYMENT = {
  // Domestic Mastercard — 4111… fails as "international cards not supported"
  card_number: "5267 3181 8797 5449",
  expiry: "any future date",
  cvv: "any 3 digits",
  phone: "9876543210",
  // Test mode sends no real OTP; Razorpay shows a mock bank page instead
  mock_bank_note:
    "On the mock bank page, click Success to complete the payment (Failure demonstrates the failed-payment path).",
};

export const DEMO_TOUR_STEPS = [
  {
    id: "login",
    title: "Log in as the demo customer",
    body: `Use ${DEMO_CREDENTIALS.customer.username} / ${DEMO_CREDENTIALS.customer.password}.`,
  },
  {
    id: "submit",
    title: "Submit a print job",
    body: "On the submit job tab, drop any PDF, pick a print tier per file (try one B&W and one colour — they route to different virtual printers), and submit. The locked total is computed server-side from real page counts.",
  },
  {
    id: "pay",
    title: "Pay with the test card",
    body: `Card ${DEMO_TEST_PAYMENT.card_number}, any future expiry, any CVV, phone ${DEMO_TEST_PAYMENT.phone}. ${DEMO_TEST_PAYMENT.mock_bank_note} No real money moves — this is Razorpay test mode.`,
  },
  {
    id: "confirm",
    title: "Watch the payment confirm",
    body: "Confirmation is webhook-driven: the job flips to QUEUED only when Razorpay's signed webhook lands — the page polls and updates itself.",
  },
  {
    id: "printing",
    title: "Watch it print",
    body: "On my jobs, the job moves QUEUED → PRINTING while the virtual printer works (a few seconds, like a real printer) → READY.",
  },
  {
    id: "output",
    title: "Open the printed output",
    body: "Each file now has a stamped PRINTED ✓ artifact with a timestamp — the proof the whole pipeline ran.",
  },
  {
    id: "shopside",
    title: "Optional: see the shop side",
    body: `Log in as ${DEMO_CREDENTIALS.admin.username} / ${DEMO_CREDENTIALS.admin.password} to see the queue, the two virtual printers, and pricing. In a real shop the loop ends with an emailed OTP entered at the counter (COLLECTED) — a physical step, so the online demo ends at READY.`,
  },
];
