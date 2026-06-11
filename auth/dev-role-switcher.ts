import { createHmac, timingSafeEqual } from "node:crypto";
import { roleSchema, type Role } from "../shared/contracts.ts";

const COOKIE_NAME = "dev-role-override";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function sign(payload: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(payload)
    .digest("base64url");
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");
    if (cookieName === name) {
      return valueParts.join("=") || null;
    }
  }
  return null;
}

export function isDevRoleSwitcherEnabled(): boolean {
  return (
    process.env.ENABLE_DEV_ROLE_SWITCHER === "true" &&
    process.env.NODE_ENV !== "production" &&
    isLocalHostname(process.env.HOST ?? "localhost")
  );
}

export function isTrustedDevOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return isLocalHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function createDevRoleCookie(userId: string, role: Role): string {
  const payload = Buffer.from(JSON.stringify({ userId, role })).toString(
    "base64url",
  );
  return [
    `${COOKIE_NAME}=${payload}.${sign(payload)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearDevRoleCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}

export function getDevRoleOverride(
  request: Request,
  expectedUserId: string,
): Role | null {
  if (!isDevRoleSwitcherEnabled()) return null;

  const cookie = readCookie(request, COOKIE_NAME);
  if (!cookie) return null;

  const separatorIndex = cookie.lastIndexOf(".");
  if (separatorIndex < 1) return null;

  const payload = cookie.slice(0, separatorIndex);
  const receivedSignature = cookie.slice(separatorIndex + 1);
  const expectedSignature = sign(payload);
  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { userId?: unknown; role?: unknown };
    if (decoded.userId !== expectedUserId) return null;

    const parsedRole = roleSchema.safeParse(decoded.role);
    return parsedRole.success ? parsedRole.data : null;
  } catch {
    return null;
  }
}
