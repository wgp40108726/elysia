import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  canUseDevRoleSwitcher,
  createDevRoleCookie,
  getDevRoleOverride,
  isDevRoleSwitcherEnabled,
  isTrustedDevOrigin,
} from "../auth/dev-role-switcher.ts";

const originalEnv = {
  secret: process.env.BETTER_AUTH_SECRET,
  host: process.env.HOST,
  nodeEnv: process.env.NODE_ENV,
  enabled: process.env.ENABLE_DEV_ROLE_SWITCHER,
  betterAuthUrl: process.env.BETTER_AUTH_URL,
};

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-with-at-least-32-characters";
  process.env.HOST = "localhost";
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEV_ROLE_SWITCHER = "true";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
});

afterEach(() => {
  process.env.BETTER_AUTH_SECRET = originalEnv.secret;
  process.env.HOST = originalEnv.host;
  process.env.NODE_ENV = originalEnv.nodeEnv;
  process.env.ENABLE_DEV_ROLE_SWITCHER = originalEnv.enabled;
  process.env.BETTER_AUTH_URL = originalEnv.betterAuthUrl;
});

describe("development role switcher", () => {
  test("is enabled locally when explicitly configured", () => {
    expect(isDevRoleSwitcherEnabled()).toBe(true);

    process.env.HOST = "0.0.0.0";
    expect(isDevRoleSwitcherEnabled()).toBe(true);
  });

  test("allows only actual admins", () => {
    expect(canUseDevRoleSwitcher(["customer", "admin"])).toBe(true);
    expect(canUseDevRoleSwitcher(["customer", "owner"])).toBe(false);

    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";

    expect(isDevRoleSwitcherEnabled()).toBe(true);
    expect(canUseDevRoleSwitcher(["customer", "admin"])).toBe(true);
    expect(canUseDevRoleSwitcher(["customer", "owner"])).toBe(false);
  });

  test("trusts the deployed application origin in production", () => {
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_URL = "https://different.example.com";

    const trustedRequest = new Request(
      "https://breakfast.example.com/api/dev/role-switcher",
      { headers: { origin: "https://breakfast.example.com" } },
    );
    const untrustedRequest = new Request(
      "https://breakfast.example.com/api/dev/role-switcher",
      { headers: { origin: "https://evil.example.com" } },
    );

    expect(isTrustedDevOrigin(trustedRequest)).toBe(true);
    expect(isTrustedDevOrigin(untrustedRequest)).toBe(false);
  });

  test("trusts the public origin forwarded by Render", () => {
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_URL = "https://different.example.com";

    const request = new Request(
      "http://internal-render-host/api/dev/role-switcher",
      {
        headers: {
          origin: "https://breakfast.onrender.com",
          "x-forwarded-host": "breakfast.onrender.com",
          "x-forwarded-proto": "https",
        },
      },
    );

    expect(isTrustedDevOrigin(request)).toBe(true);
  });

  test("reads a signed role override for the matching user", () => {
    const cookie = createDevRoleCookie("user-1", "chef").split(";")[0];
    const request = new Request("http://localhost:3000/api/me", {
      headers: { cookie },
    });

    expect(getDevRoleOverride(request, "user-1")).toBe("chef");
    expect(getDevRoleOverride(request, "user-2")).toBeNull();
  });

  test("rejects a modified cookie", () => {
    const [nameAndValue] = createDevRoleCookie("user-1", "staff").split(";");
    const [name, value] = nameAndValue.split("=");
    const [payload, signature] = value.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ userId: "user-1", role: "admin" }),
    ).toString("base64url");
    const request = new Request("http://localhost:3000/api/me", {
      headers: { cookie: `${name}=${tamperedPayload}.${signature}` },
    });

    expect(getDevRoleOverride(request, "user-1")).toBeNull();
  });
});
