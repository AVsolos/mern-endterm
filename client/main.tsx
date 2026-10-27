import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RefreshCw, X } from "lucide-react";
import type { Actor } from "../lib/domain.ts";
import BorrowLab from "./BorrowLab";
import "./styles.css";

function App() {
  const [user, setUser] = useState<Actor | null>(null),
    [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false),
    [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function loadIdentity() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/auth/me", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("The server is unavailable. Please retry.");
      const body = await r.json();
      setUser(body.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadIdentity();
  }, []);
  useEffect(() => {
    if (authOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [authOpen]);
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(new FormData(e.currentTarget));
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        signal: AbortSignal.timeout(15000),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Unable to sign in.");
      setUser(body.user);
      setAuthOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      const r = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("Could not sign out. Try again.");
      setUser(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign out.");
    }
  }
  if (loading)
    return (
      <div className="loading-state" role="status">
        <RefreshCw className="spin" /> Connecting to BorrowLab…
      </div>
    );
  return (
    <>
      {error && !authOpen && (
        <div className="alert error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void loadIdentity()}>
            Retry
          </button>
        </div>
      )}
      <BorrowLab
        key={user?.userId ?? "guest"}
        user={user}
        onSignIn={() => {
          setError("");
          setAuthOpen(true);
        }}
        onSignOut={() => void logout()}
      />
      <dialog
        ref={dialog}
        aria-labelledby="auth-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) {
            setAuthOpen(false);
            setError("");
          }
        }}
      >
        <div className="dialog-head">
          <h2 id="auth-title">
            {mode === "register"
              ? "Create your BorrowLab account"
              : "Welcome back"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close sign-in"
            disabled={busy}
            onClick={() => {
              setAuthOpen(false);
              setError("");
            }}
          >
            <X size={20} />
          </button>
        </div>
        <p className="muted-text">
          Your equipment, reservations, and workspace access stay with your
          account.
        </p>
        <form onSubmit={authenticate}>
          <fieldset disabled={busy}>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {mode === "register" && (
              <label className="field">
                Your name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={70}
                  autoComplete="name"
                />
              </label>
            )}
            <label className="field">
              Email
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                name="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
              />
            </label>
            <p className="footnote">
              Use at least 10 characters. Password reset and email verification
              are outside this student demo.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError("");
                }}
              >
                {mode === "register"
                  ? "I have an account"
                  : "Create an account"}
              </button>
              <button className="button" type="submit">
                {busy
                  ? "Please wait…"
                  : mode === "register"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
