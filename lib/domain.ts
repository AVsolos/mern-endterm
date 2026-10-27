export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export type Actor = { userId: string; displayName: string };
export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  join_code?: string;
  created_at: number;
};
export type Equipment = {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  asset_tag: string;
  location: string;
  description: string;
  status: "active" | "maintenance";
  created_at: number;
};
export type Booking = {
  id: string;
  workspace_id: string;
  equipment_id: string;
  user_id: string;
  borrower_name: string;
  starts_at: number;
  ends_at: number;
  purpose: string;
  status: "reserved" | "checked_out" | "returned" | "cancelled";
  created_at: number;
  checked_out_at: number | null;
  returned_at: number | null;
  return_note: string | null;
  equipment_name?: string;
  asset_tag?: string;
};
export type Activity = {
  id: string;
  actor_name: string;
  action: string;
  detail: string;
  created_at: number;
};
export const CATEGORIES = [
  "Cameras",
  "Audio",
  "Computing",
  "Electronics",
  "Tools",
  "Other",
] as const;
export function inputText(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AppError(`${label} must be ${min}–${max} characters.`);
  return value.trim();
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new AppError("Invalid request identifier. Refresh and try again.");
  return value;
}
export function interval(
  start: unknown,
  end: unknown,
  now: number,
): { start: number; end: number } {
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end)
  )
    throw new AppError("Choose valid start and end times.");
  if (start < now)
    throw new AppError("The reservation must start in the future.");
  if (start > now + 90 * 86400000)
    throw new AppError("Book no more than 90 days ahead.");
  if (end - start < 15 * 60000 || end - start > 7 * 86400000)
    throw new AppError("Reservations must last between 15 minutes and 7 days.");
  return { start, end };
}
export function overlaps(a: number, b: number, c: number, d: number) {
  return a < d && b > c;
}
export function isUnavailable(
  item: Equipment,
  bookings: Pick<
    Booking,
    "equipment_id" | "status" | "starts_at" | "ends_at"
  >[],
  start: number,
  end: number,
) {
  return (
    item.status !== "active" ||
    bookings.some(
      (b) =>
        b.equipment_id === item.id &&
        (b.status === "checked_out" ||
          (b.status === "reserved" &&
            overlaps(start, end, b.starts_at, b.ends_at))),
    )
  );
}
