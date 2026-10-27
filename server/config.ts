export type Config = {
  mongoUri: string;
  mongoDb: string;
  port: number;
  origin: string;
  production: boolean;
  razorpayKeyId: string;
  razorpaySecret: string;
  webhookSecret: string;
  bookingFee: number;
};
export function readConfig(source: NodeJS.ProcessEnv = process.env): Config {
  let mongoUri = source.MONGODB_URI?.trim() ?? "";
  if (
    !mongoUri &&
    source.MONGODB_HOST &&
    source.MONGODB_USERNAME &&
    source.MONGODB_PASSWORD
  ) {
    if (!/^[a-z0-9.-]+\.mongodb\.net$/i.test(source.MONGODB_HOST))
      throw new Error("MONGODB_HOST must be the Atlas hostname only.");
    mongoUri = `mongodb+srv://${encodeURIComponent(source.MONGODB_USERNAME)}:${encodeURIComponent(source.MONGODB_PASSWORD)}@${source.MONGODB_HOST}/?retryWrites=true&w=majority`;
  }
  if (!mongoUri)
    throw new Error(
      "Configure MONGODB_URI or MONGODB_HOST, MONGODB_USERNAME, and MONGODB_PASSWORD in .env.",
    );
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri))
    throw new Error("MONGODB_URI must be a MongoDB connection URI.");
  const production = source.NODE_ENV === "production";
  const vercelHost =
    source.VERCEL_ENV === "production"
      ? source.VERCEL_PROJECT_PRODUCTION_URL
      : source.VERCEL_URL;
  const origin =
    source.APP_ORIGIN ||
    (vercelHost ? `https://${vercelHost}` : "http://127.0.0.1:5173");
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== "https:"))
    throw new Error(
      "APP_ORIGIN must be an exact origin, using HTTPS in production.",
    );
  const bookingFee = Number(source.BOOKING_FEE_PAISE || 10000);
  if (
    !Number.isSafeInteger(bookingFee) ||
    bookingFee < 100 ||
    bookingFee > 1000000
  )
    throw new Error(
      "BOOKING_FEE_PAISE must be an integer from 100 to 1000000.",
    );
  const razorpayKeyId = source.RAZORPAY_KEY_ID?.trim() ?? "";
  if (razorpayKeyId && !/^rzp_test_[a-zA-Z0-9]+$/.test(razorpayKeyId))
    throw new Error(
      "Only Razorpay test keys are supported. Live keys are rejected.",
    );
  const port = Number(source.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  return {
    mongoUri,
    mongoDb: source.MONGODB_DB || "borrowlab",
    port,
    origin,
    production,
    razorpayKeyId,
    razorpaySecret: source.RAZORPAY_KEY_SECRET || "",
    webhookSecret: source.RAZORPAY_WEBHOOK_SECRET || "",
    bookingFee,
  };
}
