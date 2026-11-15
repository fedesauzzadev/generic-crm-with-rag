import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

// Helpers de frontera HTTP: toda entrada externa se valida con zod y los
// errores son legibles, sin internals (NFR N1/N5).

/** Valida un payload con zod; inválido → 422 con mensaje legible. */
export function parseWith<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") || "body";
    throw new HTTPException(422, { message: `${field}: ${issue?.message ?? "invalid value"}` });
  }
  return result.data;
}

/** Lee y parsea el body JSON; inválido → 400. */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
}
