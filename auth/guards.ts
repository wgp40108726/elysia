import type { CurrentUser, Role, SessionUser } from "../shared/contracts.ts";
import { getCurrentUser } from "./better-auth.ts";
import { getDevRoleOverride } from "./dev-role-switcher.ts";
import type { Store } from "../store/Store.ts";

const permissionByRole: Record<Role, string[]> = {
  customer: [
    "menu:read",
    "orders:create_own",
    "orders:read_own",
    "role_requests:create",
  ],
  staff: [
    "menu:read",
    "orders:create_own",
    "orders:read_own",
    "orders:read_all",
    "orders:create_on_behalf",
    "orders:update_customer",
    "orders:update_status",
    "role_requests:create",
    "menu_history:read",
  ],
  chef: [
    "menu:read",
    "orders:create_own",
    "orders:read_own",
    "orders:read_all",
    "orders:update_status",
    "role_requests:create",
  ],
  owner: [
    "menu:read",
    "menu:write",
    "menu:delete",
    "orders:create_own",
    "orders:read_own",
    "orders:read_all",
    "orders:create_on_behalf",
    "orders:update_customer",
    "orders:update_status",
    "role_requests:create",
    "role_requests:review",
    "menu_history:read",
  ],
  admin: [
    "menu:read",
    "menu:write",
    "menu:delete",
    "orders:create_own",
    "orders:read_own",
    "orders:read_all",
    "orders:create_on_behalf",
    "orders:update_customer",
    "orders:update_status",
    "role_requests:create",
    "role_requests:review",
    "users:roles:update",
    "menu_history:read",
  ],
};

export function listPermissions(roles: ReadonlyArray<Role>): string[] {
  return [...new Set(roles.flatMap((role) => permissionByRole[role]))].sort();
}

export function hasAnyRole(
  user: CurrentUser,
  allowedRoles: ReadonlyArray<Role>,
): boolean {
  return user.roles.some((role) => allowedRoles.includes(role));
}

export async function requireUser(
  request: Request,
  store: Store,
): Promise<CurrentUser> {
  const sessionUser = await getCurrentUser(request);
  if (!sessionUser) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return attachRoles(request, sessionUser, store);
}

export async function requireAnyRole(
  request: Request,
  store: Store,
  allowedRoles: ReadonlyArray<Role>,
): Promise<CurrentUser> {
  const user = await requireUser(request, store);
  if (!hasAnyRole(user, allowedRoles)) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return user;
}

function attachRoles(
  request: Request,
  user: SessionUser,
  store: Store,
): CurrentUser {
  const devRole = getDevRoleOverride(request, user.id);
  if (devRole) {
    return {
      ...user,
      roles: [devRole],
    };
  }

  const roles = store.getUserRoles(user.id);
  return {
    ...user,
    roles: roles.length > 0 ? [...roles] : ["customer"],
  };
}
