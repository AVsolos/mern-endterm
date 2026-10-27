import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { AppError } from "@/lib/domain";
import { createService } from "@/lib/service";
import type { Database } from "@/lib/service";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function context() {
  const user = await getChatGPTUser();
  if (!user) throw new AppError("Please sign in to continue.", 401);
  if (!env.DB)
    throw new AppError(
      "Storage is temporarily unavailable. Please try again.",
      503,
    );
  return { user, service: createService(env.DB as unknown as Database, user) };
}
function failure(error: unknown) {
  if (error instanceof AppError)
    return json({ error: error.message }, error.status);
  console.error(
    "Workspace operation failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return json(
    {
      error:
        "We could not save or load your workspace. Please retry; your request may already have completed.",
    },
    503,
  );
}
export async function GET(request: Request) {
  try {
    const { user, service } = await context();
    const id = new URL(request.url).searchParams.get("id");
    return json(
      id
        ? await service.snapshot(id)
        : {
            user: { userId: user.userId, displayName: user.displayName },
            workspaces: await service.listWorkspaces(),
          },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (
      !origin ||
      origin !== new URL(request.url).origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new AppError("Cross-site requests are not allowed.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("Send JSON input.", 415);
    if (Number(request.headers.get("content-length") ?? 0) > 8192)
      throw new AppError("Request too large.", 413);
    const text = await request.text();
    if (text.length > 8192) throw new AppError("Request too large.", 413);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text);
    } catch {
      throw new AppError("Invalid JSON input.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new AppError("Invalid request.");
    const { service } = await context();
    switch (input.action) {
      case "create":
        return json(await service.createWorkspace(input));
      case "join":
        return json(await service.joinWorkspace(input));
      case "add":
        return json(await service.addEquipment(input));
      case "reserve":
        return json(await service.reserve(input));
      case "transition":
        return json(await service.transition(input));
      case "status":
        return json(await service.setEquipmentStatus(input));
      case "rotate":
        return json(await service.rotateInvite(input));
      default:
        throw new AppError("Unknown action.");
    }
  } catch (error) {
    return failure(error);
  }
}
