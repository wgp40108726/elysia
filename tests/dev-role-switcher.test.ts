import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDevRoleCookie,
  getDevRoleOverride,
  isDevRoleSwitcherEnabled,
} from "../auth/dev-role-switcher.ts";

const originalEnv = {
  secret: process.env.BETTER_AUTH_SECRET,
  host: process.env.HOST,
  nodeEnv: process.env.NODE_ENV,
  enabled: process.env.ENABLE_DEV_ROLE_SWITCHER,
};

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-with-at-least-32-characters";
  process.env.HOST = "localhost";
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEV_ROLE_SWITCHER = "true";
});

afterEach(() => {
  process.env.BETTER_AUTH_SECRET = originalEnv.secret;
  process.env.HOST = originalEnv.host;
  process.env.NODE_ENV = originalEnv.nodeEnv;
  process.env.ENABLE_DEV_ROLE_SWITCHER = originalEnv.enabled;
});

describe("development role switcher", () => {
  test("is enabled only when explicitly configured on localhost", () => {
    expect(isDevRoleSwitcherEnabled()).toBe(true);

    process.env.HOST = "0.0.0.0";
    expect(isDevRoleSwitcherEnabled()).toBe(false);

    process.env.HOST = "localhost";
    process.env.NODE_ENV = "production";
    expect(isDevRoleSwitcherEnabled()).toBe(false);
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
