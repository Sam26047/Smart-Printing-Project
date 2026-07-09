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

export default razorpay;
