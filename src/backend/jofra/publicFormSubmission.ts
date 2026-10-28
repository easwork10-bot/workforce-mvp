import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  businessInquirySchema,
  jobApplicationSchema,
  type JofraPublicFormType,
} from "@/shared/jofra-public-form-schemas";
import { sendJofraFormEmail } from "./publicFormsEmail";
import {
  markPublicSubmissionSent,
  releasePublicSubmission,
  reservePublicSubmission,
} from "./publicFormRedis";
import { getTrustedClientIp } from "@/backend/security/clientIp";

const MAX_BODY_BYTES = 16 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: object, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getAllowedOrigins(): Set<string> | null {
  const entries = process.env.JOFRA_PUBLIC_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);
  if (!entries?.length) return null;
  const origins = new Set<string>();

  for (const entry of entries) {
    try {
      const url = new URL(entry);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== entry) return null;
      origins.add(url.origin);
    } catch {
      return null;
    }
  }
  return origins;
}

async function readJsonBody(request: NextRequest): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415 }
> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, status: 415 };

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, status: 400 };
    if (Number(contentLength) > MAX_BODY_BYTES) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

function getFieldErrors(
  issues: Array<{ path: PropertyKey[] }>,
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || field === "website" || field === "locale") continue;
    fieldErrors[field] = ["invalid"];
  }
  return fieldErrors;
}

export async function submitJofraPublicForm(
  request: NextRequest,
  type: JofraPublicFormType,
): Promise<NextResponse> {
  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins) {
    console.error("[Jofra public forms] Origin allowlist is not configured");
    return jsonResponse({ error: "service_unavailable" }, 503);
  }
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return jsonResponse({ error: "origin_rejected" }, 403);
  }

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.status === 413 ? "too_large" : "invalid_request" }, parsedBody.status);
  }
  if (!parsedBody.value || typeof parsedBody.value !== "object" || Array.isArray(parsedBody.value)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const rawBody = parsedBody.value as Record<string, unknown>;
  if (typeof rawBody.website === "string" && rawBody.website.length > 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const schema = type === "inquiry" ? businessInquirySchema : jobApplicationSchema;
  const validation = schema.safeParse(rawBody);
  if (!validation.success) {
    return jsonResponse({ error: "validation", fieldErrors: getFieldErrors(validation.error.issues) }, 400);
  }

  const ip = getTrustedClientIp(request);
  if (!ip) {
    console.error("[Jofra public forms] Trusted client IP is unavailable");
    return jsonResponse({ error: "service_unavailable" }, 503);
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  let reservation;
  try {
    reservation = await reservePublicSubmission(type, ip, idempotencyKey);
  } catch {
    console.error("[Jofra public forms] Abuse protection is unavailable");
    return jsonResponse({ error: "service_unavailable" }, 503);
  }

  if (reservation.status === "already-sent") return jsonResponse({ ok: true }, 200);
  if (reservation.status === "in-progress") return jsonResponse({ error: "duplicate_in_progress" }, 409);
  if (reservation.status === "rate-limited") return jsonResponse({ error: "rate_limited" }, 429);

  const requestId = randomUUID();
  try {
    await sendJofraFormEmail(type, validation.data, reservation.providerKey);
  } catch {
    await releasePublicSubmission(reservation.redisKey).catch(() => {
      console.error(`[Jofra public forms] Submission reservation cleanup failed (${requestId})`);
    });
    console.error(`[Jofra public forms] Email delivery failed (${requestId})`);
    return jsonResponse({ error: "delivery_failed" }, 502);
  }

  try {
    await markPublicSubmissionSent(reservation.redisKey);
  } catch {
    console.error(`[Jofra public forms] Delivery receipt could not be recorded (${requestId})`);
  }

  return jsonResponse({ ok: true }, 202);
}
