import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { AppError, inputText } from "../lib/domain.ts";
import type { Actor } from "../lib/domain.ts";
import { duplicate } from "./database.ts";
import type { Store } from "./database.ts";
const scrypt = promisify(scryptCallback);
const SESSION_MS = 7 * 86400000;
export const SESSION_COOKIE = "borrowlab_session";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hex] = encoded.split(":");
  if (!salt || !hex || hex.length !== 128) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, "hex"));
}
function credentials(input: Record<string, unknown>) {
  const email = inputText(input.email, "Email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter a valid email address.");
  if (typeof input.password !== "string" || input.password.length < 10 || input.password.length > 128) throw new AppError("Password must be 10–128 characters.");
  return { email, password: input.password };
}
export function sessionToken(cookieHeader: string | undefined) {
  const part = cookieHeader?.split(";").map(s => s.trim()).find(s => s.startsWith(`${SESSION_COOKIE}=`));
  const token = part?.slice(SESSION_COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function createAuth(store: Store) {
  async function session(userId: string) {
    const token = randomBytes(32).toString("hex");
    await store.sessions.insertOne({ _id: hashToken(token), user_id: userId, expires_at: new Date(Date.now() + SESSION_MS) });
    return token;
  }
  async function register(input: Record<string, unknown>) {
    const { email, password } = credentials(input), name = inputText(input.name, "Name", 2, 70), id = crypto.randomUUID();
    const password_hash = await hashPassword(password);
    try { await store.users.insertOne({ _id: id, email, name, password_hash, created_at: Date.now() }); }
    catch (e) { if (duplicate(e)) throw new AppError("An account already exists with this email. Sign in instead.", 409); throw e; }
    return { user: { userId: id, displayName: name }, token: await session(id) };
  }
  async function login(input: Record<string, unknown>) {
    const { email, password } = credentials(input);
    const user = await store.users.findOne({ email });
    // Perform the same KDF even for an unknown email.
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await verifyPassword(password, user?.password_hash ?? dummy);
    if (!user || !valid) throw new AppError("Email or password is incorrect.", 401);
    return { user: { userId: user._id, displayName: user.name }, token: await session(user._id) };
  }
  async function current(cookieHeader: string | undefined): Promise<Actor | null> {
    const token = sessionToken(cookieHeader); if (!token) return null;
    const stored = await store.sessions.findOne({ _id: hashToken(token), expires_at: { $gt: new Date() } });
    const user = stored ? await store.users.findOne({ _id: stored.user_id }) : null;
    return user ? { userId: user._id, displayName: user.name } : null;
  }
  async function logout(cookieHeader: string | undefined) { const token = sessionToken(cookieHeader); if (token) await store.sessions.deleteOne({ _id: hashToken(token) }); }
  return { register, login, current, logout };
}
