import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { AppError } from "../lib/domain.ts";
import type { Actor } from "../lib/domain.ts";
import type { Store } from "./database.ts";
import type { Config } from "./config.ts";
import { createAuth, SESSION_COOKIE } from "./auth.ts";
import { createService } from "./service.ts";
import { createPayments } from "./payments.ts";
import type { Gateway } from "./payments.ts";

export function createApp(
  store: Store,
  config: Config,
  options: {
    rateLimits?: boolean;
    gateway?: Gateway;
    serveClient?: boolean;
  } = {},
) {
  const app = express(),
    auth = createAuth(store);
  const payments = createPayments(store, config, options.gateway);
  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: config.production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "https://checkout.razorpay.com"],
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
              ],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              frameSrc: [
                "https://api.razorpay.com",
                "https://checkout.razorpay.com",
                "https://*.razorpay.com",
              ],
              connectSrc: ["'self'", "https://*.razorpay.com"],
              imgSrc: ["'self'", "data:", "https://*.razorpay.com"],
              formAction: ["'self'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (_req, res, next) => {
    try {
      await store.db.command({ ping: 1 });
      res.json({ status: "ok", database: "mongodb", payments: "test" });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      bookingFee: config.bookingFee,
      paymentsConfigured: !!config.razorpayKeyId && !!config.razorpaySecret,
      mode: "test",
    }),
  );
  // Verify the untouched webhook body before JSON parsing or browser origin checks.
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json", limit: "64kb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError("Send a JSON webhook body.");
      res.json(
        await payments.webhook(
          req.body,
          req.headers["x-razorpay-signature"],
          req.headers["x-razorpay-event-id"],
        ),
      );
    },
  );
  app.use("/api", (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (
      req.headers.origin !== config.origin ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return next(new AppError("Cross-site requests are not allowed.", 403));
    if (!req.is("application/json"))
      return next(new AppError("Send JSON input.", 415));
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  if (options.rateLimits !== false)
    app.use(
      "/api",
      rateLimit({
        windowMs: 60000,
        limit: 180,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: { error: "Too many requests. Please wait a minute." },
      }),
    );
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
    skip: () => options.rateLimits === false,
  });
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 86400000,
  };
  app.get("/api/auth/me", async (req, res) => {
    res.json({ user: await auth.current(req.headers.cookie) });
  });
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const result = await auth.register(req.body ?? {});
    await auth.logout(req.headers.cookie);
    res
      .cookie(SESSION_COOKIE, result.token, cookieOptions)
      .status(201)
      .json({ user: result.user });
  });
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const result = await auth.login(req.body ?? {});
    await auth.logout(req.headers.cookie);
    res
      .cookie(SESSION_COOKIE, result.token, cookieOptions)
      .json({ user: result.user });
  });
  app.post("/api/auth/logout", async (req, res) => {
    await auth.logout(req.headers.cookie);
    res
      .clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        path: "/",
      })
      .json({ ok: true });
  });
  app.use(["/api/workspace", "/api/payments"], async (req, res, next) => {
    const user = await auth.current(req.headers.cookie);
    if (!user) throw new AppError("Please sign in to continue.", 401);
    res.locals.user = user;
    next();
  });
  app.post("/api/payments/order", async (req, res) =>
    res.json(
      await payments.createOrder(req.body?.bookingId, res.locals.user as Actor),
    ),
  );
  app.post("/api/payments/verify", async (req, res) =>
    res.json(await payments.verify(req.body ?? {}, res.locals.user as Actor)),
  );
  app.post("/api/payments/reconcile", async (req, res) =>
    res.json(
      await payments.reconcile(req.body?.bookingId, res.locals.user as Actor),
    ),
  );
  app.get("/api/workspace", async (req, res) => {
    const user = res.locals.user as Actor,
      service = createService(store, user, Date.now(), config.bookingFee);
    res.json(
      req.query.id
        ? await service.snapshot(req.query.id)
        : { user, workspaces: await service.listWorkspaces() },
    );
  });
  app.post("/api/workspace", async (req, res) => {
    const input = req.body;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new AppError("Invalid request.");
    const service = createService(
      store,
      res.locals.user as Actor,
      Date.now(),
      config.bookingFee,
    );
    switch (input.action) {
      case "create":
        return res.json(await service.createWorkspace(input));
      case "join":
        return res.json(await service.joinWorkspace(input));
      case "add":
        return res.json(await service.addEquipment(input));
      case "reserve":
        return res.json(await service.reserve(input));
      case "transition":
        return res.json(await service.transition(input));
      case "status":
        return res.json(await service.setEquipmentStatus(input));
      case "rotate":
        return res.json(await service.rotateInvite(input));
      default:
        throw new AppError("Unknown action.");
    }
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError("API endpoint not found.", 404)),
  );
  if (config.production && options.serveClient !== false) {
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile("index.html", {
        root: dist,
        headers: { "Cache-Control": "no-cache" },
      }),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof AppError)
        return res.status(error.status).json({ error: error.message });
      const err = error as { type?: string; code?: number; name?: string };
      if (err.type === "entity.too.large")
        return res.status(413).json({ error: "Request too large." });
      if (err.type === "entity.parse.failed")
        return res.status(400).json({ error: "Invalid JSON input." });
      if (err.code === 11000)
        return res
          .status(409)
          .json({
            error:
              "This request conflicts with an existing record. Refresh and try again.",
          });
      console.error("Request failed", {
        name: err.name ?? "Error",
        code: err.code,
      });
      return res
        .status(503)
        .json({
          error:
            "The service is temporarily unavailable. Retry safely or refresh to check whether your action completed.",
        });
    },
  );
  return app;
}
