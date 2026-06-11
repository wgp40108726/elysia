import { createHmac, timingSafeEqual } from "node:crypto";
import { roleSchema, type Role } from "../shared/contracts.ts";

const COOKIE_NAME = "dev-role-override";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isLocalMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    isLocalHostname(process.env.HOST ?? "localhost")
  );
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
  return process.env.ENABLE_DEV_ROLE_SWITCHER === "true";
}

export function canUseDevRoleSwitcher(
  actualRoles: ReadonlyArray<Role>,
): boolean {
  if (!isDevRoleSwitcherEnabled()) return false;
  return actualRoles.includes("admin");
}

export function isTrustedDevOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    if (isLocalMode()) {
      return isLocalHostname(originUrl.hostname);
    }

    const requestOrigin = new URL(request.url).origin;
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const forwardedOrigin =
      forwardedHost && forwardedProto
        ? `${forwardedProto.split(",")[0].trim()}://${forwardedHost.split(",")[0].trim()}`
        : undefined;
    const trustedOrigins = [
      requestOrigin,
      forwardedOrigin,
      process.env.BETTER_AUTH_URL,
      process.env.API_ALLOWED_ORIGIN,
    ]
      .filter((value): value is string => Boolean(value && value !== "*"))
      .map((value) => new URL(value).origin);
    return trustedOrigins.includes(originUrl.origin);
  } catch {
    return false;
  }
}

export function createDevRoleCookie(userId: string, role: Role): string {
  const payload = Buffer.from(JSON.stringify({ userId, role })).toString(
    "base64url",
  );
  const attributes = [
    `${COOKIE_NAME}=${payload}.${sign(payload)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (
    process.env.NODE_ENV === "production" ||
    process.env.BETTER_AUTH_URL?.startsWith("https://")
  ) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
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
