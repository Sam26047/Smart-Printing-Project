// frontend/src/utils/loadRazorpay.js
// Singleton loader for Razorpay's hosted Checkout script. The script is only
// ever injected once; concurrent callers share the same promise. The key used
// to open the modal always comes from the ORDER RESPONSE (server-owned), never
// from frontend config — this module only loads the vendor script.

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let razorpayPromise = null;

export default function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (razorpayPromise) return razorpayPromise;

  razorpayPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => {
      razorpayPromise = null; // allow a retry on the next click
      reject(new Error("Payment system unavailable — check your connection and retry"));
    };
    document.body.appendChild(script);
  });

  return razorpayPromise;
}
