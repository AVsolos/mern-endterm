"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  AudioLines,
  Box,
  CalendarDays,
  Camera,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Copy,
  Cpu,
  Grid2X2,
  History,
  Laptop,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { CATEGORIES, isUnavailable } from "@/lib/domain";
import type {
  Actor,
  Workspace,
  Equipment,
  Booking,
  Activity,
} from "@/lib/domain";

type Snapshot = {
  workspace: Workspace;
  manager: boolean;
  equipment: Equipment[];
  bookings: Booking[];
  availability: Pick<
    Booking,
    "equipment_id" | "status" | "starts_at" | "ends_at"
  >[];
  activity: Activity[];
  memberCount: number;
};
type Modal = {
  kind: "create" | "join" | "add" | "reserve" | "return" | "cancel" | "rotate";
  id: string;
  item?: Equipment;
  booking?: Booking;
};
const icons = {
  Cameras: Camera,
  Audio: AudioLines,
  Computing: Laptop,
  Electronics: Cpu,
  Tools: Wrench,
  Other: Box,
};
function Icon({ category, size = 22 }: { category: string; size?: number }) {
  const Component = icons[category as keyof typeof icons] ?? Box;
  return <Component size={size} strokeWidth={1.6} />;
}
const formatDate = (n: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(n);
function localInput(n: number) {
  const date = new Date(n);
  return new Date(n - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const newId = () => crypto.randomUUID();
async function api<T = { id: string }>(
  path = "",
  body?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/workspace${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(data.error || "Something went wrong. Please try again.");
    return data as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      throw new Error(
        "The request timed out. Retry the same action safely, or refresh to check its result.",
      );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
function Dialog({
  title,
  close,
  children,
  busy,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function GearArt({ category }: { category: string }) {
  return (
    <div
      className={`gear-art art-${category.toLowerCase()}`}
      aria-hidden="true"
    >
      <div className="art-ring" />
      <Icon category={category} size={78} />
      <span className="art-cross one">+</span>
      <span className="art-cross two">+</span>
      <span className="art-caption">BORROW / CREATE / RETURN</span>
    </div>
  );
}

export default function BorrowLab({ user }: { user: Actor | null }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [selected, setSelected] = useState("");
  const [data, setData] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(!!user),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("Equipment"),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All equipment"),
    [availableOnly, setAvailableOnly] = useState(false);
  const [bookingFilter, setBookingFilter] = useState("Active"),
    [modal, setModal] = useState<Modal | null>(null);
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [clock, setClock] = useState(Date.now());
  const generation = useRef(0),
    mutationLock = useRef(false);
  useEffect(() => {
    const n = Math.ceil((Date.now() + 5 * 60000) / 60000) * 60000;
    setStart(localInput(n));
    setEnd(localInput(n + 2 * 3600000));
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const loadList = useCallback(async () => {
    const result = await api<{ workspaces: Workspace[] }>();
    setWorkspaces(result.workspaces);
    return result.workspaces;
  }, []);
  const refresh = useCallback(async (id: string, showLoading = false) => {
    const token = ++generation.current;
    if (showLoading) setLoading(true);
    try {
      const result = await api<Snapshot>(`?id=${encodeURIComponent(id)}`);
      if (generation.current === token) setData(result);
    } catch (e) {
      if (generation.current === token)
        setError(e instanceof Error ? e.message : "Could not load workspace.");
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadList()
      .then((list) => {
        if (!cancelled) {
          if (list.length) setSelected(list[0].id);
          else setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, loadList]);
  useEffect(() => {
    if (!selected) return;
    setData(null);
    void refresh(selected, true);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(selected);
    }, 30000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [selected, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  function open(kind: Modal["kind"], item?: Equipment, booking?: Booking) {
    setError("");
    setModal({ kind, id: newId(), item, booking });
  }
  async function perform(
    body: Record<string, unknown>,
    message: string,
    selectNew = false,
  ) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("", { workspaceId: selected, ...body });
      setModal(null);
      setNotice(message);
      if (selectNew) {
        await loadList();
        if (selected === result.id) await refresh(result.id);
        else setSelected(result.id);
        setTab("Equipment");
      } else if (selected) await refresh(selected);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this action.",
      );
    } finally {
      setBusy(false);
      mutationLock.current = false;
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    if (modal.kind === "create")
      await perform(
        {
          action: "create",
          id: modal.id,
          name: fields.name,
          sample: fields.sample === "on",
        },
        "Workspace created. Your equipment library is ready.",
        true,
      );
    if (modal.kind === "join")
      await perform(
        { action: "join", code: fields.code },
        "You joined the workspace.",
        true,
      );
    if (modal.kind === "add")
      await perform(
        { action: "add", id: modal.id, ...fields },
        "Equipment added to the library.",
      );
    if (modal.kind === "reserve")
      await perform(
        {
          action: "reserve",
          id: modal.id,
          equipmentId: modal.item?.id,
          startsAt: new Date(String(fields.start)).getTime(),
          endsAt: new Date(String(fields.end)).getTime(),
          purpose: fields.purpose,
        },
        "Reservation confirmed. Find it in Reservations.",
      );
    if (modal.kind === "return")
      await perform(
        {
          action: "transition",
          id: modal.booking?.id,
          transition: "return",
          note: fields.note,
        },
        "Return recorded. Equipment is available again.",
      );
    if (modal.kind === "cancel")
      await perform(
        { action: "transition", id: modal.booking?.id, transition: "cancel" },
        "Reservation cancelled. The time slot has been released.",
      );
    if (modal.kind === "rotate")
      await perform(
        { action: "rotate" },
        "Invitation rotated. The old code no longer works.",
      );
  }
  const startMs = new Date(start).getTime(),
    endMs = new Date(end).getTime();
  const validSlot =
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs - startMs >= 900000 &&
    endMs - startMs <= 7 * 86400000 &&
    startMs >= clock &&
    startMs <= clock + 90 * 86400000;
  const equipment = data?.equipment ?? [],
    bookings = data?.bookings ?? [];
  const free = equipment.filter(
    (e) => !isUnavailable(e, data?.availability ?? [], startMs, endMs),
  );
  const filtered = equipment.filter(
    (e) =>
      (category === "All equipment" || e.category === category) &&
      `${e.name} ${e.asset_tag} ${e.location}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!availableOnly || (validSlot && free.includes(e))),
  );
  const active = bookings.filter(
    (b) =>
      b.status === "checked_out" ||
      (b.status === "reserved" && b.ends_at > clock),
  );
  const overdue = bookings.filter(
    (b) => b.status === "checked_out" && b.ends_at < clock,
  );
  const shownBookings = bookings.filter(
    (b) =>
      bookingFilter === "All" ||
      (bookingFilter === "Active"
        ? active.includes(b)
        : bookingFilter === "Overdue"
          ? overdue.includes(b)
          : b.status === "returned" ||
            b.status === "cancelled" ||
            (b.status === "reserved" && b.ends_at <= clock)),
  );
  const initials = (user?.displayName ?? "Guest")
    .split(/[ @]/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const titles: Record<string, string> = {
    Equipment: "Good gear. Great possibilities.",
    Reservations: "Every loan, accounted for.",
    Activity: "A little transparency goes a long way.",
    Workspace: "Your space, working together.",
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Box size={25} />
          </span>
          Borrow<span>Lab</span>
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace-picker">
          <label htmlFor="workspace-switch">WORKSPACE</label>
          {workspaces.length > 0 ? (
            <select
              id="workspace-switch"
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setError("");
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="workspace-placeholder">Your next big idea</div>
          )}
          <span className="workspace-caption">
            Shared equipment, less friction.
          </span>
        </div>
        <nav aria-label="Main navigation">
          {[
            ["Equipment", Grid2X2],
            ["Reservations", CalendarDays],
            ...(data?.manager ? [["Activity", History]] : []),
            ["Workspace", Settings2],
          ].map(([name, Component]) => {
            const NavIcon = Component as typeof Box;
            return (
              <button
                key={name as string}
                className={`nav-item ${tab === name ? "selected" : ""}`}
                onClick={() => setTab(name as string)}
                aria-current={tab === name ? "page" : undefined}
              >
                <NavIcon size={19} />
                <span>{name as string}</span>
                {name === "Reservations" && active.length > 0 && (
                  <span className="nav-count">{active.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <div className="little-orbit">
            <Sparkles size={20} />
          </div>
          <strong>
            Less owning.
            <br />
            More creating.
          </strong>
          <p>A shared shelf of possibilities for your next project.</p>
          <span>MAKE SOMETHING GOOD ↗</span>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{user?.displayName ?? "Welcome, creator"}</strong>
            <small>
              {data?.manager
                ? "Workspace manager"
                : user
                  ? "Workspace member"
                  : "Find your creative toolkit"}
            </small>
          </div>
          {user && (
            <a
              href="/signout-with-chatgpt?return_to=/"
              target="_top"
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </a>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <i /> Built for sharing
            </span>
            <span className="avatar small">{initials}</span>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">THE SHARED TOOLKIT</div>
              <h1>{tab}</h1>
              <p>{titles[tab]}</p>
            </div>
            <div className="heading-actions">
              {selected && (
                <button
                  className="button secondary icon-only"
                  aria-label="Refresh workspace"
                  disabled={loading || busy}
                  onClick={() => void refresh(selected, true)}
                >
                  <RefreshCw size={17} className={loading ? "spin" : ""} />
                </button>
              )}
              {data?.manager && tab === "Equipment" && (
                <button className="button" onClick={() => open("add")}>
                  <Plus size={17} /> Add equipment
                </button>
              )}
            </div>
          </div>
          {error && !modal && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() => {
                  setError("");
                  if (selected) void refresh(selected, true);
                  else
                    void loadList()
                      .then((list) => {
                        if (list[0]) setSelected(list[0].id);
                      })
                      .catch((e) => setError(e.message));
                }}
              >
                Retry loading
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCheck size={18} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!user ? (
            <section className="welcome-panel">
              <span className="large-icon">
                <Box size={42} />
              </span>
              <div className="eyebrow">MEET BORROWLAB</div>
              <h2>
                Your next project starts
                <br />
                with the right equipment.
              </h2>
              <p>
                Find what you need, reserve a time, and get creating. One shared
                workspace for your club, lab, or team.
              </p>
              <a
                className="button"
                href="/signin-with-chatgpt?return_to=/"
                target="_top"
              >
                Sign in with ChatGPT <ArrowUpRight size={18} />
              </a>
              <div className="welcome-features">
                <span>
                  <ShieldCheck size={18} /> Conflict-safe bookings
                </span>
                <span>
                  <Users size={18} /> Private team workspaces
                </span>
                <span>
                  <CheckCheck size={18} /> Tracked handovers
                </span>
              </div>
              <small>
                Evaluating the project? Sign in and create your own workspace
                with sample equipment.
              </small>
            </section>
          ) : loading && !data ? (
            <div className="loading-state" role="status">
              <RefreshCw className="spin" /> Loading your workspace…
            </div>
          ) : !data ? (
            <section className="welcome-panel">
              <span className="large-icon">
                <Users size={42} />
              </span>
              <div className="eyebrow">A BETTER WAY TO SHARE</div>
              <h2>
                Make room for
                <br />
                your next big idea.
              </h2>
              <p>
                Create a home for your team’s equipment, or join an existing
                workspace with an invitation code.
              </p>
              <div className="row-actions">
                <button className="button" onClick={() => open("create")}>
                  <Plus size={17} /> Create a workspace
                </button>
                <button
                  className="button secondary"
                  onClick={() => open("join")}
                >
                  Join a workspace
                </button>
              </div>
              <small>
                Start with six sample assets to try the entire booking workflow.
              </small>
            </section>
          ) : (
            <>
              {tab === "Equipment" && (
                <>
                  <section
                    className="stats-grid"
                    aria-label="Workspace summary"
                  >
                    <div className="stat">
                      <span>
                        Total equipment <Box size={18} />
                      </span>
                      <strong>
                        {equipment.length.toString().padStart(2, "0")}
                      </strong>
                      <small>Ideas start here</small>
                    </div>
                    <div className="stat">
                      <span>
                        Available for your slot <span className="status-dot" />
                      </span>
                      <strong>
                        {validSlot
                          ? free.length.toString().padStart(2, "0")
                          : "—"}
                      </strong>
                      <small>
                        {validSlot
                          ? "Ready for your next project"
                          : "Choose a valid time below"}
                      </small>
                    </div>
                    <div className="stat">
                      <span>
                        {data.manager
                          ? "Active reservations"
                          : "Your active reservations"}{" "}
                        <CalendarDays size={18} />
                      </span>
                      <strong>
                        {active.length.toString().padStart(2, "0")}
                      </strong>
                      <small>
                        {overdue.length
                          ? `${overdue.length} overdue · follow up now`
                          : "From reservation to return"}
                      </small>
                    </div>
                    <div className="stat accent-stat">
                      <span>
                        A little care goes a long way <Sparkles size={18} />
                      </span>
                      <p>
                        Borrow thoughtfully.
                        <br />
                        Return it ready.
                      </p>
                      <small>The next great idea is someone else’s.</small>
                    </div>
                  </section>
                  <section
                    className="slot-panel"
                    aria-label="Choose a reservation time"
                  >
                    <div className="slot-label">
                      <CalendarDays size={22} />
                      <div>
                        <strong>When do you need it?</strong>
                        <span>Availability updates for your time slot</span>
                      </div>
                    </div>
                    <label>
                      Pick up
                      <input
                        aria-label="Pick up"
                        type="datetime-local"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <span className="slot-arrow">→</span>
                    <label>
                      Return
                      <input
                        aria-label="Return"
                        type="datetime-local"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                  </section>
                  <div className="slot-footnote">
                    Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                    Book 15 minutes–7 days, up to 90 days ahead.
                    {!validSlot && (
                      <strong>
                        {" "}
                        Choose a future start and a valid duration.
                      </strong>
                    )}
                  </div>
                  <div className="catalog-toolbar">
                    <div className="search-box">
                      <Search size={18} />
                      <input
                        aria-label="Search equipment"
                        placeholder="Search equipment, asset tag, location…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <label className="available-toggle">
                      <input
                        type="checkbox"
                        checked={availableOnly}
                        onChange={(e) => setAvailableOnly(e.target.checked)}
                      />{" "}
                      Available only
                    </label>
                    <span className="result-count">
                      {filtered.length} items
                    </span>
                  </div>
                  <div
                    className="category-tabs"
                    aria-label="Equipment categories"
                  >
                    {["All equipment", ...CATEGORIES].map((c) => (
                      <button
                        key={c}
                        className={category === c ? "active" : ""}
                        onClick={() => setCategory(c)}
                        aria-pressed={category === c}
                      >
                        {c === "All equipment" ? (
                          <SlidersHorizontal size={15} />
                        ) : (
                          <Icon category={c} size={15} />
                        )}{" "}
                        {c}
                      </button>
                    ))}
                  </div>
                  {filtered.length ? (
                    <div className="equipment-grid">
                      {filtered.map((item) => {
                        const available = validSlot && free.includes(item),
                          out = data.availability.some(
                            (b) =>
                              b.equipment_id === item.id &&
                              b.status === "checked_out",
                          );
                        return (
                          <article className="equipment-card" key={item.id}>
                            <div className="art-wrap">
                              <GearArt category={item.category} />
                              <span
                                className={`availability-pill ${available ? "green" : "muted"}`}
                              >
                                <i />
                                {item.status === "maintenance"
                                  ? "In maintenance"
                                  : out
                                    ? "Checked out"
                                    : !validSlot
                                      ? "Choose a time"
                                      : available
                                        ? "Available"
                                        : "Reserved for slot"}
                              </span>
                              <span className="asset-tag">
                                {item.asset_tag}
                              </span>
                            </div>
                            <div className="equipment-body">
                              <div className="equipment-category">
                                {item.category}
                              </div>
                              <h2>{item.name}</h2>
                              <p>
                                {item.description ||
                                  "Ready for your team’s next project."}
                              </p>
                              <span className="location">
                                <MapPin size={14} />
                                {item.location}
                              </span>
                              <div className="card-footer">
                                <span>Shared equipment</span>
                                <button
                                  className="reserve-button"
                                  disabled={!available || busy}
                                  onClick={() => open("reserve", item)}
                                >
                                  Reserve <ArrowUpRight size={16} />
                                </button>
                              </div>
                              {data.manager && (
                                <button
                                  disabled={busy}
                                  className="maintenance-button"
                                  onClick={() =>
                                    void perform(
                                      {
                                        action: "status",
                                        id: item.id,
                                        status:
                                          item.status === "active"
                                            ? "maintenance"
                                            : "active",
                                      },
                                      "Equipment service status updated.",
                                    )
                                  }
                                >
                                  <Wrench size={12} />
                                  {item.status === "active"
                                    ? "Mark for maintenance"
                                    : "Restore to service"}
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Search size={30} />
                      <h2>
                        {equipment.length
                          ? "No equipment matches"
                          : "Your shared shelf is empty"}
                      </h2>
                      <p>
                        {equipment.length
                          ? "Try a different category, search, or time slot."
                          : "Your manager can add the first item to get started."}
                      </p>
                      {equipment.length > 0 && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            setSearch("");
                            setCategory("All equipment");
                            setAvailableOnly(false);
                          }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {tab === "Reservations" && (
                <>
                  <div className="section-note">
                    <ShieldCheck size={21} />
                    <div>
                      <strong>
                        {data.manager
                          ? "You manage handovers for this workspace"
                          : "Your bookings, from pickup to return"}
                      </strong>
                      <p>
                        {data.manager
                          ? "Checkout opens 15 minutes before pickup. Check the kit together, then record its return."
                          : "Ask your manager to check out your kit. You can cancel any reservation that has not been checked out."}
                      </p>
                    </div>
                  </div>
                  <div className="category-tabs">
                    {["Active", "Overdue", "History", "All"].map((f) => (
                      <button
                        key={f}
                        className={bookingFilter === f ? "active" : ""}
                        onClick={() => setBookingFilter(f)}
                      >
                        {f}
                        {f === "Overdue" && overdue.length > 0
                          ? ` (${overdue.length})`
                          : ""}
                      </button>
                    ))}
                  </div>
                  <div className="booking-list">
                    {shownBookings.map((b) => {
                      const late =
                          b.status === "checked_out" && b.ends_at < clock,
                        expired = b.status === "reserved" && b.ends_at <= clock;
                      return (
                        <article key={b.id} className="booking-card">
                          <div className="booking-icon">
                            <Icon
                              category={
                                equipment.find((e) => e.id === b.equipment_id)
                                  ?.category ?? "Other"
                              }
                            />
                          </div>
                          <div className="booking-detail">
                            <div className="booking-title">
                              <h2>{b.equipment_name}</h2>
                              <span
                                className={`badge ${late ? "danger" : b.status === "returned" ? "green" : ""}`}
                              >
                                {late
                                  ? "Overdue"
                                  : expired
                                    ? "Expired"
                                    : b.status.replace("_", " ")}
                              </span>
                            </div>
                            <p>
                              {b.borrower_name} <span>·</span> {b.asset_tag}
                            </p>
                            <div className="booking-time">
                              <Clock3 size={14} />
                              {formatDate(b.starts_at)} →{" "}
                              {formatDate(b.ends_at)}
                            </div>
                            <p className="booking-purpose">{b.purpose}</p>
                            {b.return_note && (
                              <p className="return-note">
                                <Check size={14} />
                                {b.return_note}
                              </p>
                            )}
                            <small className="booking-reference">
                              Reference {b.id.slice(0, 8).toUpperCase()}
                            </small>
                          </div>
                          <div className="booking-actions">
                            {b.status === "reserved" && (
                              <>
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                  onClick={() => open("cancel", undefined, b)}
                                >
                                  Cancel
                                </button>
                                {data.manager && !expired && (
                                  <button
                                    className="button"
                                    disabled={
                                      busy || b.starts_at > clock + 15 * 60000
                                    }
                                    title="Available 15 minutes before pickup"
                                    onClick={() =>
                                      void perform(
                                        {
                                          action: "transition",
                                          id: b.id,
                                          transition: "checkout",
                                        },
                                        "Equipment checked out. Have a great session.",
                                      )
                                    }
                                  >
                                    <ArrowUpRight size={16} /> Check out
                                  </button>
                                )}
                              </>
                            )}
                            {b.status === "checked_out" && data.manager && (
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() => open("return", undefined, b)}
                              >
                                <ArrowDownLeft size={16} /> Record return
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {shownBookings.length === 0 && (
                      <div className="empty-state">
                        <CalendarDays size={32} />
                        <h2>No {bookingFilter.toLowerCase()} reservations</h2>
                        <p>
                          Reserve equipment and your bookings will appear here.
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => setTab("Equipment")}
                        >
                          Explore equipment <ArrowUpRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="footnote">
                    Showing up to 250 most recent{" "}
                    {data.manager ? "workspace" : "personal"} reservations.
                    Availability always checks all active bookings.
                  </p>
                </>
              )}
              {tab === "Activity" && data.manager && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Workspace activity</h2>
                    <span className="badge">Latest 80 events</span>
                  </div>
                  <p className="muted-text">
                    A record of real reservations, handovers, membership, and
                    inventory changes.
                  </p>
                  <div className="timeline">
                    {data.activity.map((a) => (
                      <div key={a.id} className="timeline-item">
                        <span className="timeline-dot">
                          <Check size={13} />
                        </span>
                        <div>
                          <strong>{a.action}</strong>
                          <p>{a.detail}</p>
                          <small>
                            {a.actor_name} · {formatDate(a.created_at)}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {tab === "Workspace" && (
                <div className="settings-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>{data.workspace.name}</h2>
                      <Users size={22} />
                    </div>
                    <p className="muted-text">
                      A shared home for your team’s tools and creative
                      equipment.
                    </p>
                    <div className="settings-row">
                      <span>Your role</span>
                      <strong>{data.manager ? "Manager" : "Borrower"}</strong>
                    </div>
                    <div className="settings-row">
                      <span>Members</span>
                      <strong>{data.memberCount}</strong>
                    </div>
                    <div className="settings-row">
                      <span>Equipment</span>
                      <strong>{equipment.length}</strong>
                    </div>
                    <div className="settings-row">
                      <span>Created</span>
                      <strong>{formatDate(data.workspace.created_at)}</strong>
                    </div>
                    <div className="row-actions">
                      <button
                        className="button secondary"
                        onClick={() => open("create")}
                      >
                        <Plus size={16} /> New workspace
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => open("join")}
                      >
                        Join another
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        {data.manager
                          ? "Invite your team"
                          : "You’re in good company"}
                      </h2>
                      <ShieldCheck size={22} />
                    </div>
                    {data.manager ? (
                      <>
                        <p className="muted-text">
                          Share this code with trusted teammates. Anyone with it
                          can join as a borrower.
                        </p>
                        <label className="field">
                          Workspace invitation
                          <input
                            value={data.workspace.join_code ?? ""}
                            readOnly
                            onFocus={(e) => e.target.select()}
                          />
                        </label>
                        <div className="row-actions">
                          <button
                            className="button"
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(data.workspace.join_code ?? "")
                                .then(() => setNotice("Invitation copied."))
                                .catch(() =>
                                  setError(
                                    "Clipboard unavailable. Select and copy the invitation manually.",
                                  ),
                                );
                            }}
                          >
                            <Copy size={16} /> Copy code
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => open("rotate")}
                          >
                            Rotate code
                          </button>
                        </div>
                        <p className="footnote">
                          Rotating a code prevents new joins with the old code.
                          Existing members keep their access.
                        </p>
                      </>
                    ) : (
                      <p className="muted-text">
                        Your manager handles invitations, equipment, and
                        handovers. You can search the library, reserve
                        equipment, and manage your own reservations.
                      </p>
                    )}
                  </section>
                  <section className="panel rules-panel">
                    <h2>A good borrowing habit</h2>
                    <div className="rules">
                      <div>
                        <span>01</span>
                        <strong>Reserve with intention</strong>
                        <p>
                          Choose the time you actually need. Cancel early if
                          plans change.
                        </p>
                      </div>
                      <div>
                        <span>02</span>
                        <strong>Check together</strong>
                        <p>
                          Meet your manager at pickup and confirm the kit is
                          complete.
                        </p>
                      </div>
                      <div>
                        <span>03</span>
                        <strong>Return it ready</strong>
                        <p>
                          Bring everything back on time and mention any issues.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              BorrowLab <span>·</span> Good things are better shared.
            </span>
            <span>Made for teams that make things.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Dialog
          busy={busy}
          close={() => {
            setModal(null);
            setError("");
          }}
          title={
            {
              create: "Create your workspace",
              join: "Join a workspace",
              add: "Add equipment",
              reserve: "Reserve equipment",
              return: "Record a return",
              cancel: "Cancel this reservation?",
              rotate: "Rotate invitation code?",
            }[modal.kind]
          }
        >
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {error && (
                <div className="alert error" role="alert">
                  {error}
                </div>
              )}
              {modal.kind === "create" && (
                <>
                  <p className="muted-text">
                    A dedicated space for your lab, club, or team. You’ll be its
                    manager.
                  </p>
                  <label className="field">
                    Workspace name
                    <input
                      name="name"
                      required
                      minLength={3}
                      maxLength={60}
                      placeholder="e.g. Campus creative lab"
                      autoFocus
                    />
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" name="sample" defaultChecked />{" "}
                    Include six sample assets to explore the workflow
                  </label>
                  <p className="footnote">
                    Sample assets are real editable inventory records in this
                    workspace.
                  </p>
                </>
              )}
              {modal.kind === "join" && (
                <>
                  <p className="muted-text">
                    Ask your workspace manager for an invitation code.
                  </p>
                  <label className="field">
                    Invitation code
                    <input
                      name="code"
                      required
                      placeholder="Paste your invitation code"
                      autoFocus
                    />
                  </label>
                </>
              )}
              {modal.kind === "add" && (
                <>
                  <label className="field">
                    Equipment name
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="e.g. Manfrotto travel tripod"
                      autoFocus
                    />
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      Category
                      <select name="category">
                        {CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Asset tag
                      <input
                        name="assetTag"
                        required
                        minLength={2}
                        maxLength={24}
                        placeholder="TRI-001"
                      />
                    </label>
                  </div>
                  <label className="field">
                    Pickup location
                    <input
                      name="location"
                      required
                      minLength={2}
                      maxLength={100}
                      placeholder="Media lab · Cabinet C"
                    />
                  </label>
                  <label className="field">
                    Description / included parts
                    <textarea
                      name="description"
                      maxLength={500}
                      rows={3}
                      placeholder="What comes with this item?"
                    />
                  </label>
                </>
              )}
              {modal.kind === "reserve" && (
                <>
                  <div className="reservation-item">
                    <Icon
                      category={modal.item?.category ?? "Other"}
                      size={32}
                    />
                    <div>
                      <strong>{modal.item?.name}</strong>
                      <small>
                        {modal.item?.asset_tag} · {modal.item?.location}
                      </small>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      Pick up
                      <input
                        name="start"
                        type="datetime-local"
                        defaultValue={start}
                        required
                      />
                    </label>
                    <label className="field">
                      Return
                      <input
                        name="end"
                        type="datetime-local"
                        defaultValue={end}
                        required
                      />
                    </label>
                  </div>
                  <label className="field">
                    What are you working on?
                    <textarea
                      name="purpose"
                      required
                      minLength={5}
                      maxLength={300}
                      rows={3}
                      placeholder="e.g. Recording interviews for our campus documentary"
                    />
                  </label>
                  <div className="booking-policy">
                    <ShieldCheck size={19} />
                    <p>
                      Availability is checked again when you confirm. Your
                      manager will handle equipment checkout and return.
                    </p>
                  </div>
                </>
              )}
              {modal.kind === "return" && (
                <>
                  <p className="muted-text">
                    Confirm that{" "}
                    <strong>{modal.booking?.equipment_name}</strong> is back
                    before recording the return.
                  </p>
                  <label className="field">
                    Condition and return notes
                    <textarea
                      name="note"
                      maxLength={300}
                      rows={3}
                      placeholder="All parts present, in good condition"
                      autoFocus
                    />
                  </label>
                  <p className="footnote">
                    If repairs are needed, mark the item for maintenance after
                    returning it. Resolve upcoming reservations first.
                  </p>
                </>
              )}
              {modal.kind === "cancel" && (
                <p className="muted-text">
                  This releases your reservation for{" "}
                  <strong>{modal.booking?.equipment_name}</strong> on{" "}
                  {formatDate(modal.booking!.starts_at)}. You can make a new
                  reservation if the slot remains available.
                </p>
              )}
              {modal.kind === "rotate" && (
                <p className="muted-text">
                  The current invitation will stop working immediately. Existing
                  members keep their access. Share the new code with anyone you
                  still want to invite.
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Go back
                </button>
                <button type="submit" className="button">
                  {busy ? (
                    <>
                      <RefreshCw size={16} className="spin" /> Saving…
                    </>
                  ) : (
                    {
                      create: "Create workspace",
                      join: "Join workspace",
                      add: "Add equipment",
                      reserve: "Confirm reservation",
                      return: "Confirm return",
                      cancel: "Cancel reservation",
                      rotate: "Rotate code",
                    }[modal.kind]
                  )}
                </button>
              </div>
            </fieldset>
          </form>
        </Dialog>
      )}
    </div>
  );
}
