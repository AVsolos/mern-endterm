import { AppError, CATEGORIES, inputText, interval, uuid } from "./domain.ts";
import type { Actor, Workspace, Equipment, Booking, Activity } from "./domain.ts";

// D1 in production, real SQLite in tests: the same parameterized workflow queries.
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
type Input = Record<string, unknown>;
const newId = () => crypto.randomUUID();
export function createService(db: Database, actor: Actor, now = Date.now()) {
  const stmt = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values);
  const one = <T>(sql: string, ...values: unknown[]) => stmt(sql, ...values).first<T>();
  const all = async <T>(sql: string, ...values: unknown[]) => (await stmt(sql, ...values).all<T>()).results;
  async function access(id: unknown, manager = false) {
    const workspace = await one<Workspace>(`SELECT w.* FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE w.id = ? AND m.user_id = ?`, uuid(id), actor.userId);
    if (!workspace) throw new AppError("Workspace not found or access denied.", 404);
    if (manager && workspace.owner_id !== actor.userId) throw new AppError("Only the workspace manager can do that.", 403);
    return workspace;
  }
  function event(workspace: string, action: string, resource: string, detail: string, conditional = true) {
    return stmt(`INSERT INTO audit (id, workspace_id, actor_id, actor_name, action, resource_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? ${conditional ? "WHERE changes() > 0" : ""}`, newId(), workspace, actor.userId, actor.displayName, action, resource, detail, now);
  }
  async function mutate(change: Statement, workspace: string, action: string, resource: string, detail: string) {
    await db.batch([change, event(workspace, action, resource, detail)]);
  }
  async function listWorkspaces() {
    return all<Workspace>(`SELECT w.id, w.name, w.owner_id, w.created_at FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at DESC`, actor.userId);
  }
  async function snapshot(id: unknown) {
    const w = await access(id); const manager = w.owner_id === actor.userId;
    const [items, ownBookings, availability, activity, people] = await Promise.all([
      all<Equipment>("SELECT * FROM equipment WHERE workspace_id = ? ORDER BY name", w.id),
      all<Booking>(`SELECT b.*, e.name AS equipment_name, e.asset_tag FROM bookings b JOIN equipment e ON e.id = b.equipment_id WHERE b.workspace_id = ? ${manager ? "" : "AND b.user_id = ?"} ORDER BY b.created_at DESC LIMIT 250`, w.id, ...(manager ? [] : [actor.userId])),
      all<Pick<Booking, "equipment_id" | "status" | "starts_at" | "ends_at">>("SELECT equipment_id, status, starts_at, ends_at FROM bookings WHERE workspace_id = ? AND (status = 'checked_out' OR (status = 'reserved' AND ends_at > ?))", w.id, now),
      manager ? all<Activity>("SELECT id, actor_name, action, detail, created_at FROM audit WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 80", w.id) : Promise.resolve([]),
      one<{ count: number }>("SELECT count(*) AS count FROM members WHERE workspace_id = ?", w.id),
    ]);
    return { workspace: { ...w, join_code: manager ? w.join_code : undefined }, manager, equipment: items, bookings: ownBookings, availability, activity, memberCount: people?.count ?? 0 };
  }
  async function createWorkspace(input: Input) {
    const id = uuid(input.id), name = inputText(input.name, "Workspace name", 3, 60);
    const existing = await one<Workspace>("SELECT * FROM workspaces WHERE id = ?", id);
    if (existing) { if (existing.owner_id === actor.userId && existing.name === name) return { id }; throw new AppError("Request identifier already used.", 409); }
    if ((await listWorkspaces()).length >= 10) throw new AppError("You can belong to at most 10 workspaces.");
    const inserts = [stmt("INSERT INTO workspaces (id, name, owner_id, join_code, created_at) VALUES (?, ?, ?, ?, ?)", id, name, actor.userId, newId(), now), stmt("INSERT INTO members (workspace_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)", id, actor.userId, actor.displayName, now)];
    if (input.sample === true) {
      const samples = [
        ["Sony Alpha a6400", "Cameras", "CAM-001", "Media lab · Cabinet A", "Mirrorless camera with 16–50mm lens, battery, and charger."],
        ["Canon EOS 200D II", "Cameras", "CAM-002", "Media lab · Cabinet A", "DSLR kit with 18–55mm lens and carrying case."],
        ["Zoom H5 recorder", "Audio", "AUD-001", "Media lab · Shelf B", "Portable field recorder with stereo capsule and windscreen."],
        ["Rode Wireless GO II", "Audio", "AUD-002", "Media lab · Shelf B", "Two wireless transmitters, receiver, and USB charging cables."],
        ["Wacom Intuos Pro", "Computing", "COM-001", "Design studio · Desk 3", "Medium pen tablet with stylus and USB cable."],
        ["Arduino starter kit", "Electronics", "ELE-001", "Maker space · Drawer 2", "Uno board, breadboard, jumper wires, and sensor pack."],
      ];
      for (const s of samples) inserts.push(stmt("INSERT INTO equipment (id, workspace_id, name, category, asset_tag, location, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)", newId(), id, ...s, now));
    }
    inserts.push(event(id, "Workspace created", id, name, false));
    await db.batch(inserts); return { id };
  }
  async function joinWorkspace(input: Input) {
    const w = await one<Workspace>("SELECT * FROM workspaces WHERE join_code = ?", uuid(input.code));
    if (!w) throw new AppError("That invitation is invalid or has been rotated.", 404);
    if ((await listWorkspaces()).length >= 10) throw new AppError("You can belong to at most 10 workspaces.");
    await mutate(stmt("INSERT OR IGNORE INTO members (workspace_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)", w.id, actor.userId, actor.displayName, now), w.id, "Member joined", actor.userId, actor.displayName);
    return { id: w.id };
  }
  async function addEquipment(input: Input) {
    const w = await access(input.workspaceId, true), id = uuid(input.id);
    const name = inputText(input.name, "Equipment name", 2, 80), tag = inputText(input.assetTag, "Asset tag", 2, 24).toUpperCase();
    const location = inputText(input.location, "Location", 2, 100), description = inputText(input.description ?? "", "Description", 0, 500);
    if (!CATEGORIES.includes(input.category as typeof CATEGORIES[number])) throw new AppError("Choose a valid category.");
    const existing = await one<Equipment>("SELECT * FROM equipment WHERE id = ?", id);
    if (existing) { if (existing.workspace_id === w.id && existing.name === name && existing.asset_tag === tag && existing.category === input.category && existing.location === location && existing.description === description) return { id }; throw new AppError("Request identifier already used.", 409); }
    await mutate(stmt(`INSERT INTO equipment (id, workspace_id, name, category, asset_tag, location, description, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'active', ? WHERE NOT EXISTS (SELECT 1 FROM equipment WHERE workspace_id = ? AND asset_tag = ?)`, id, w.id, name, input.category, tag, location, description, now, w.id, tag), w.id, "Equipment added", id, `${name} · ${tag}`);
    if (!await one("SELECT id FROM equipment WHERE id = ?", id)) throw new AppError("That asset tag is already in use.", 409);
    return { id };
  }
  async function reserve(input: Input) {
    const w = await access(input.workspaceId), id = uuid(input.id), equipmentId = uuid(input.equipmentId);
    const purpose = inputText(input.purpose, "Purpose", 5, 300);
    const existing = await one<Booking>("SELECT * FROM bookings WHERE id = ?", id);
    if (existing) {
      if (existing.user_id === actor.userId && existing.workspace_id === w.id && existing.equipment_id === equipmentId && existing.starts_at === input.startsAt && existing.ends_at === input.endsAt && existing.purpose === purpose) return { id };
      throw new AppError("Request identifier already used for a different reservation.", 409);
    }
    const { start, end } = interval(input.startsAt, input.endsAt, now);
    const e = await one<Equipment>("SELECT * FROM equipment WHERE id = ? AND workspace_id = ?", equipmentId, w.id);
    if (!e) throw new AppError("Equipment not found.", 404);
    await mutate(stmt(`INSERT INTO bookings (id, workspace_id, equipment_id, user_id, borrower_name, starts_at, ends_at, purpose, status, created_at)
      SELECT ?, ?, e.id, ?, ?, ?, ?, ?, 'reserved', ? FROM equipment e WHERE e.id = ? AND e.workspace_id = ? AND e.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.equipment_id = e.id AND (b.status = 'checked_out' OR (b.status = 'reserved' AND b.starts_at < ? AND b.ends_at > ?)))`, id, w.id, actor.userId, actor.displayName, start, end, purpose, now, equipmentId, w.id, end, start), w.id, "Reservation made", id, `${e.name} · ${new Date(start).toISOString()}`);
    if (!await one("SELECT id FROM bookings WHERE id = ?", id)) throw new AppError("This equipment is no longer available for that time. Choose another slot or item.", 409);
    return { id };
  }
  async function transition(input: Input) {
    const w = await access(input.workspaceId), id = uuid(input.id);
    const b = await one<Booking>("SELECT * FROM bookings WHERE id = ? AND workspace_id = ?", id, w.id);
    if (!b) throw new AppError("Reservation not found.", 404);
    const manager = w.owner_id === actor.userId, action = input.transition;
    if (!manager && (b.user_id !== actor.userId || action !== "cancel")) throw new AppError("You do not have permission to change this loan.", 403);
    let change: Statement, target: string, detail: string;
    if (action === "cancel") {
      target = "cancelled"; detail = "Reservation cancelled";
      change = stmt("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'reserved'", id);
    } else if (action === "checkout" && manager) {
      target = "checked_out"; detail = "Equipment checked out";
      change = stmt(`UPDATE bookings SET status = 'checked_out', checked_out_at = ? WHERE id = ? AND status = 'reserved' AND starts_at <= ? AND ends_at > ? AND NOT EXISTS (SELECT 1 FROM bookings other WHERE other.equipment_id = bookings.equipment_id AND other.status = 'checked_out')`, now, id, now + 15 * 60000, now);
    } else if (action === "return" && manager) {
      target = "returned"; detail = inputText(input.note ?? "", "Return note", 0, 300) || "Returned in good condition";
      change = stmt("UPDATE bookings SET status = 'returned', returned_at = ?, return_note = ? WHERE id = ? AND status = 'checked_out'", now, detail, id);
    } else throw new AppError("Invalid booking action.");
    if (b.status === target) return { id };
    await mutate(change, w.id, action === "return" ? "Equipment returned" : detail, id, `${b.borrower_name} · ${detail}`);
    const updated = await one<Booking>("SELECT * FROM bookings WHERE id = ?", id);
    if (updated?.status !== target) throw new AppError(action === "checkout" ? "Checkout opens 15 minutes before the booking, closes at its end, and requires the previous loan to be returned." : "This reservation has changed. Refresh and try again.", 409);
    return { id };
  }
  async function setEquipmentStatus(input: Input) {
    const w = await access(input.workspaceId, true), id = uuid(input.id);
    if (input.status !== "active" && input.status !== "maintenance") throw new AppError("Invalid equipment status.");
    const e = await one<Equipment>("SELECT * FROM equipment WHERE id = ? AND workspace_id = ?", id, w.id);
    if (!e) throw new AppError("Equipment not found.", 404);
    if (e.status === input.status) return { id };
    await mutate(stmt(`UPDATE equipment SET status = ? WHERE id = ? AND workspace_id = ? AND status <> ? AND (? = 'active' OR NOT EXISTS (SELECT 1 FROM bookings WHERE equipment_id = ? AND (status = 'checked_out' OR (status = 'reserved' AND ends_at > ?))))`, input.status, id, w.id, input.status, input.status, id, now), w.id, "Service status changed", id, `${e.name} · ${input.status}`);
    const updated = await one<Equipment>("SELECT * FROM equipment WHERE id = ?", id);
    if (updated?.status !== input.status) throw new AppError("Cancel upcoming reservations and return outstanding loans before enabling maintenance.", 409);
    return { id };
  }
  async function rotateInvite(input: Input) {
    const w = await access(input.workspaceId, true);
    await mutate(stmt("UPDATE workspaces SET join_code = ? WHERE id = ?", newId(), w.id), w.id, "Invitation rotated", w.id, "Previous invitation is no longer valid.");
    return { id: w.id };
  }
  return { listWorkspaces, snapshot, createWorkspace, joinWorkspace, addEquipment, reserve, transition, setEquipmentStatus, rotateInvite };
}
