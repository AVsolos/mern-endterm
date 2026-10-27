import type { ClientSession } from "mongodb";
import { AppError, CATEGORIES, inputText, interval, uuid } from "../lib/domain.ts";
import type { Actor } from "../lib/domain.ts";
import { transaction, duplicate, publicRecord } from "./database.ts";
import type { Store, EquipmentDoc, BookingDoc } from "./database.ts";
type Input = Record<string, unknown>;
const newId = () => crypto.randomUUID();
export function createService(store: Store, actor: Actor, now = Date.now(), feePaise = 0) {
  async function access(id: unknown, manager = false, session?: ClientSession) {
    const workspaceId = uuid(id);
    const membership = await store.members.findOne({ workspace_id: workspaceId, user_id: actor.userId }, { session });
    const workspace = membership ? await store.workspaces.findOne({ _id: workspaceId }, { session }) : null;
    if (!workspace) throw new AppError("Workspace not found or access denied.", 404);
    if (manager && workspace.owner_id !== actor.userId) throw new AppError("Only the workspace manager can do that.", 403);
    return workspace;
  }
  async function event(workspaceId: string, action: string, resourceId: string, detail: string, session: ClientSession) {
    const id = newId();
    await store.audit.insertOne({ _id: id, id, workspace_id: workspaceId, actor_id: actor.userId, actor_name: actor.displayName, action, resource_id: resourceId, detail, created_at: now }, { session });
  }
  // Acquiring a write conflict before querying reservations prevents snapshot write skew.
  async function lockEquipment(id: string, workspaceId: string, session: ClientSession) {
    const e = await store.equipment.findOneAndUpdate({ _id: id, workspace_id: workspaceId }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
    if (!e) throw new AppError("Equipment not found.", 404);
    return e;
  }
  async function listWorkspaces() {
    const membership = await store.members.find({ user_id: actor.userId }).toArray();
    return (await store.workspaces.find({ _id: { $in: membership.map(m => m.workspace_id) } }, { projection: { join_code: 0 } }).sort({ created_at: -1 }).toArray()).map(publicRecord);
  }
  async function snapshot(id: unknown) {
    const w = await access(id), manager = w.owner_id === actor.userId;
    const [items, bookings, availability, activity, memberCount] = await Promise.all([
      store.equipment.find({ workspace_id: w.id }).sort({ name: 1 }).toArray(),
      store.bookings.find({ workspace_id: w.id, ...(manager ? {} : { user_id: actor.userId }) }, { projection: { order_claim: 0, order_claimed_at: 0 } }).sort({ created_at: -1 }).limit(250).toArray(),
      store.bookings.find({ workspace_id: w.id, $or: [{ status: "checked_out" }, { status: "reserved", ends_at: { $gt: now } }] }, { projection: { _id: 0, equipment_id: 1, status: 1, starts_at: 1, ends_at: 1 } }).toArray(),
      manager ? store.audit.find({ workspace_id: w.id }).sort({ created_at: -1, _id: -1 }).limit(80).toArray() : Promise.resolve([]),
      store.members.countDocuments({ workspace_id: w.id }),
    ]);
    return { workspace: { ...publicRecord(w), join_code: manager ? w.join_code : undefined }, manager, equipment: items.map(publicRecord), bookings: bookings.map(b => ({ ...publicRecord(b), equipment_name: items.find(e => e.id === b.equipment_id)?.name, asset_tag: items.find(e => e.id === b.equipment_id)?.asset_tag })), availability, activity: activity.map(publicRecord), memberCount };
  }
  async function createWorkspace(input: Input) {
    const id = uuid(input.id), name = inputText(input.name, "Workspace name", 3, 60);
    const existing = await store.workspaces.findOne({ _id: id });
    if (existing) { if (existing.owner_id === actor.userId && existing.name === name) return { id }; throw new AppError("Request identifier already used.", 409); }
    if ((await listWorkspaces()).length >= 10) throw new AppError("You can belong to at most 10 workspaces.");
    await transaction(store, async session => {
      await store.workspaces.insertOne({ _id: id, id, name, owner_id: actor.userId, join_code: newId(), created_at: now }, { session });
      await store.members.insertOne({ _id: `${id}:${actor.userId}`, workspace_id: id, user_id: actor.userId, name: actor.displayName, joined_at: now }, { session });
      if (input.sample === true) {
        const samples = [
          ["Sony Alpha a6400", "Cameras", "CAM-001", "Media lab · Cabinet A", "Mirrorless camera with 16–50mm lens, battery, and charger."],
          ["Canon EOS 200D II", "Cameras", "CAM-002", "Media lab · Cabinet A", "DSLR kit with 18–55mm lens and carrying case."],
          ["Zoom H5 recorder", "Audio", "AUD-001", "Media lab · Shelf B", "Portable field recorder with stereo capsule and windscreen."],
          ["Rode Wireless GO II", "Audio", "AUD-002", "Media lab · Shelf B", "Two wireless transmitters, receiver, and USB charging cables."],
          ["Wacom Intuos Pro", "Computing", "COM-001", "Design studio · Desk 3", "Medium pen tablet with stylus and USB cable."],
          ["Arduino starter kit", "Electronics", "ELE-001", "Maker space · Drawer 2", "Uno board, breadboard, jumper wires, and sensor pack."],
        ];
        await store.equipment.insertMany(samples.map(([name, category, asset_tag, location, description]) => { const itemId = newId(); return { _id: itemId, id: itemId, workspace_id: id, name, category, asset_tag, location, description, status: "active" as const, created_at: now, revision: 0 }; }), { session });
      }
      await event(id, "Workspace created", id, name, session);
    });
    return { id };
  }
  async function joinWorkspace(input: Input) {
    const code = uuid(input.code);
    if ((await listWorkspaces()).length >= 10) throw new AppError("You can belong to at most 10 workspaces.");
    return transaction(store, async session => {
      // Write the invitation document so rotation and joining serialize.
      const w = await store.workspaces.findOneAndUpdate({ join_code: code }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
      if (!w) throw new AppError("That invitation is invalid or has been rotated.", 404);
      const result = await store.members.updateOne({ _id: `${w.id}:${actor.userId}` }, { $setOnInsert: { workspace_id: w.id, user_id: actor.userId, name: actor.displayName, joined_at: now } }, { upsert: true, session });
      if (result.upsertedCount) await event(w.id, "Member joined", actor.userId, actor.displayName, session);
      return { id: w.id };
    });
  }
  async function addEquipment(input: Input) {
    const w = await access(input.workspaceId, true), id = uuid(input.id);
    const name = inputText(input.name, "Equipment name", 2, 80), tag = inputText(input.assetTag, "Asset tag", 2, 24).toUpperCase();
    const location = inputText(input.location, "Location", 2, 100), description = inputText(input.description ?? "", "Description", 0, 500);
    if (!CATEGORIES.includes(input.category as typeof CATEGORIES[number])) throw new AppError("Choose a valid category.");
    const existing = await store.equipment.findOne({ _id: id });
    if (existing) { if (existing.workspace_id === w.id && existing.name === name && existing.asset_tag === tag && existing.category === input.category && existing.location === location && existing.description === description) return { id }; throw new AppError("Request identifier already used.", 409); }
    try {
      await transaction(store, async session => {
        await store.equipment.insertOne({ _id: id, id, workspace_id: w.id, name, category: String(input.category), asset_tag: tag, location, description, status: "active", created_at: now, revision: 0 }, { session });
        await event(w.id, "Equipment added", id, `${name} · ${tag}`, session);
      });
    } catch (e) { if (duplicate(e)) throw new AppError("That asset tag or request identifier is already in use.", 409); throw e; }
    return { id };
  }
  async function reserve(input: Input) {
    const w = await access(input.workspaceId), id = uuid(input.id), equipmentId = uuid(input.equipmentId), purpose = inputText(input.purpose, "Purpose", 5, 300);
    return transaction(store, async session => {
      const e = await lockEquipment(equipmentId, w.id, session);
      const existing = await store.bookings.findOne({ _id: id }, { session });
      if (existing) {
        if (existing.user_id === actor.userId && existing.workspace_id === w.id && existing.equipment_id === equipmentId && existing.starts_at === input.startsAt && existing.ends_at === input.endsAt && existing.purpose === purpose) return { id };
        throw new AppError("Request identifier already used for a different reservation.", 409);
      }
      const { start, end } = interval(input.startsAt, input.endsAt, now);
      const conflict = await store.bookings.findOne({ equipment_id: equipmentId, $or: [{ status: "checked_out" }, { status: "reserved", starts_at: { $lt: end }, ends_at: { $gt: start } }] }, { session });
      if (e.status !== "active" || conflict) throw new AppError("This equipment is no longer available for that time. Choose another slot or item.", 409);
      await store.bookings.insertOne({ _id: id, id, workspace_id: w.id, equipment_id: equipmentId, user_id: actor.userId, borrower_name: actor.displayName, starts_at: start, ends_at: end, purpose, status: "reserved", created_at: now, checked_out_at: null, returned_at: null, return_note: null, revision: 0, fee_paise: feePaise, payment_status: feePaise === 0 ? "paid" : "unpaid" }, { session });
      await event(w.id, "Reservation made", id, `${e.name} · ${new Date(start).toISOString()}`, session);
      return { id };
    });
  }
  async function transition(input: Input) {
    const w = await access(input.workspaceId), id = uuid(input.id), action = input.transition;
    return transaction(store, async session => {
      let b = await store.bookings.findOne({ _id: id, workspace_id: w.id }, { session });
      if (!b) throw new AppError("Reservation not found.", 404);
      const manager = w.owner_id === actor.userId;
      if (!manager && (b.user_id !== actor.userId || action !== "cancel")) throw new AppError("You do not have permission to change this loan.", 403);
      await lockEquipment(b.equipment_id, w.id, session);
      b = await store.bookings.findOneAndUpdate({ _id: id }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
      if (!b) throw new AppError("Reservation not found.", 404);
      let target: BookingDoc["status"], detail: string, updates: Partial<BookingDoc> = {};
      if (action === "cancel") {
        target = "cancelled"; detail = "Reservation cancelled";
        if (b.status === target) return { id };
        if (b.status !== "reserved") throw new AppError("Only reserved equipment can be cancelled.", 409);
      } else if (action === "checkout" && manager) {
        target = "checked_out"; detail = "Equipment checked out";
        if (b.status === target) return { id };
        if (b.payment_status !== "paid") throw new AppError("The borrower must complete the verified test booking fee before checkout.", 409);
        const outstanding = await store.bookings.findOne({ equipment_id: b.equipment_id, status: "checked_out" }, { session });
        if (b.status !== "reserved" || b.starts_at > now + 15 * 60000 || b.ends_at <= now || outstanding) throw new AppError("Checkout opens 15 minutes before the booking, closes at its end, and requires the previous loan to be returned.", 409);
        updates.checked_out_at = now;
      } else if (action === "return" && manager) {
        target = "returned"; detail = inputText(input.note ?? "", "Return note", 0, 300) || "Returned in good condition";
        if (b.status === target) return { id };
        if (b.status !== "checked_out") throw new AppError("Only checked-out equipment can be returned.", 409);
        updates.returned_at = now; updates.return_note = detail;
      } else throw new AppError("Invalid booking action.");
      await store.bookings.updateOne({ _id: id }, { $set: { ...updates, status: target } }, { session });
      await event(w.id, action === "return" ? "Equipment returned" : detail, id, `${b.borrower_name} · ${detail}`, session);
      return { id };
    });
  }
  async function setEquipmentStatus(input: Input) {
    const w = await access(input.workspaceId, true), id = uuid(input.id);
    if (input.status !== "active" && input.status !== "maintenance") throw new AppError("Invalid equipment status.");
    const status: EquipmentDoc["status"] = input.status;
    return transaction(store, async session => {
      const e = await lockEquipment(id, w.id, session);
      if (e.status === status) return { id };
      const outstanding = await store.bookings.findOne({ equipment_id: id, $or: [{ status: "checked_out" }, { status: "reserved", ends_at: { $gt: now } }] }, { session });
      if (status === "maintenance" && outstanding) throw new AppError("Cancel upcoming reservations and return outstanding loans before enabling maintenance.", 409);
      await store.equipment.updateOne({ _id: id }, { $set: { status } }, { session });
      await event(w.id, "Service status changed", id, `${e.name} · ${status}`, session);
      return { id };
    });
  }
  async function rotateInvite(input: Input) {
    const w = await access(input.workspaceId, true);
    await transaction(store, async session => { await store.workspaces.updateOne({ _id: w.id }, { $set: { join_code: newId() } }, { session }); await event(w.id, "Invitation rotated", w.id, "Previous invitation is no longer valid.", session); });
    return { id: w.id };
  }
  return { listWorkspaces, snapshot, createWorkspace, joinWorkspace, addEquipment, reserve, transition, setEquipmentStatus, rotateInvite };
}
