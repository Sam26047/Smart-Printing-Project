// backend/utils/razorpayClient.js
// Singleton Razorpay SDK instance (test-mode keys from config). Only order
// creation goes through the SDK — webhook signature verification is a plain
// HMAC over the raw body in payments.controller.js and needs no SDK.

import Razorpay from "razorpay";
import config from "../config/config.js";

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

// Thin wrapper over the real Razorpay refund API. The SDK (v2.9.x) exposes no
// per-request idempotency header, so double-refund safety is NOT provided here
// — it is guaranteed by the caller's DB transaction + row lock + state guard
// (a job already REFUNDED never reaches this call). amountPaise is refunded
// against the original payment. Throws on API failure so the caller rolls back.
export async function refundPayment(paymentId, amountPaise) {
  return razorpay.payments.refund(paymentId, { amount: amountPaise, speed: "normal" });
}

export default razorpay;
