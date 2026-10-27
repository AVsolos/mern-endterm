type CheckoutResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type CheckoutOptions = {
  key: string; order_id: string; amount: number; currency: string; name: string; description: string;
  theme: { color: string }; handler: (result: CheckoutResult) => void;
  modal: { ondismiss: () => void }; retry: { enabled: boolean };
};
declare global { interface Window { Razorpay?: new(options: CheckoutOptions) => { open(): void; on(event: string, handler: () => void): void } } }
let loading: Promise<void> | undefined;
async function loadCheckout() {
  if (window.Razorpay) return;
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.async = true;
    const timeout = setTimeout(() => { script.remove(); loading = undefined; reject(new Error("Razorpay checkout timed out. Please retry.")); }, 15000);
    script.onload = () => { clearTimeout(timeout); if (window.Razorpay) resolve(); else { loading = undefined; reject(new Error("Razorpay checkout is unavailable.")); } };
    script.onerror = () => { clearTimeout(timeout); script.remove(); loading = undefined; reject(new Error("Could not load Razorpay. Check your connection or browser blocker.")); };
    document.head.appendChild(script);
  });
  return loading;
}
export async function paymentRequest<T = { paid: boolean }>(route: string, input: object): Promise<T> {
  const r = await fetch(`/api/payments/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
  const body = await r.json(); if (!r.ok) throw new Error(body.error || "Could not process the test payment."); return body;
}
export async function payBooking(bookingId: string) {
  await loadCheckout();
  const order = await paymentRequest<{ key: string; orderId: string; amount: number; currency: string; mode: string }>("order", { bookingId });
  if (!order.key.startsWith("rzp_test_") || order.mode !== "test") throw new Error("Only Razorpay test checkout is supported.");
  const result = await new Promise<CheckoutResult>((resolve, reject) => {
    const checkout = new window.Razorpay!({ key: order.key, order_id: order.orderId, amount: order.amount, currency: order.currency,
      name: "BorrowLab · TEST MODE", description: "Non-refundable test booking fee. No real money is charged.", theme: { color: "#236b53" }, retry: { enabled: false },
      handler: resolve, modal: { ondismiss: () => reject(new Error("Checkout dismissed. Your reservation remains unpaid; you can retry or cancel it.")) },
    });
    checkout.on("payment.failed", () => reject(new Error("Test payment failed. Your booking remains unpaid. Retry or check payment status.")));
    checkout.open();
  });
  try { await paymentRequest("verify", { bookingId, ...result }); }
  catch (e) { throw new Error(`${e instanceof Error ? e.message : "Verification is pending."} Use Check payment status before paying again.`); }
}
