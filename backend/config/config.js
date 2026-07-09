// backend/config/config.js

// Fail fast: payments can't work half-configured, and a missing webhook secret
// would make signature verification silently impossible. This runs before any
// module that imports config (incl. the Razorpay SDK constructor), so the
// process dies with a clear message instead of a stack trace.
const missingRzp = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]
  .filter((k) => !process.env[k]);
if (missingRzp.length > 0) {
  console.error(`❌ Missing Razorpay env vars: ${missingRzp.join(", ")} — add them to .env (see .env.example)`);
  process.exit(1);
}

export default {
  db: {
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  jwtSecret:   process.env.JWT_SECRET,
  // Agent auth is now per-shop device tokens stored (hashed) in agent_tokens —
  // the global AGENT_SECRET env var is gone. See middleware/agentAuth.js.
  port: process.env.PORT || 5000,
  email: {
    host:  process.env.EMAIL_HOST,
    port:  Number(process.env.EMAIL_PORT) || 587,
    user:  process.env.EMAIL_USER,
    pass:  process.env.EMAIL_PASS,
    from:  process.env.EMAIL_FROM || process.env.EMAIL_USER,
  },
  razorpay: {
    keyId:         process.env.RAZORPAY_KEY_ID,         // rzp_test_... (test mode)
    keySecret:     process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, // signs webhook payloads (HMAC-SHA256)
  },
};