import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  CurrentUser,
  InternalRole,
  MenuItem,
  MenuItemVersion,
  MenuSnapshot,
  Order,
  OrderItem,
  OrderStatus,
  Role,
  RoleRequest,
} from "../../shared/contracts.ts";
import { db } from "../../db/client.ts";
import {
  menuItemVersionsTable,
  menuItemsTable,
  menuSnapshotsTable,
  orderItemsTable,
  ordersTable,
  roleRequestsTable,
  userRolesTable,
} from "../../db/schema.ts";
import { user } from "../../db/auth-schema.ts";
import type { Store } from "../Store.ts";

interface PgStoreOptions {
  dataFilePath?: string;
}

// Seed 用的內部型別（來自 data/store.json）
// V9: 只播 menu，users 由 Better Auth 管理，orders 需真實 session 才能建立
interface SeedData {
  menu?: MenuItem[];
  orders?: Array<{
    id: number;
    userId: string | number;
    status: "pending" | "submitted";
    total: number;
    createdAt: string;
    submittedAt?: string;
    items: Array<{ item: MenuItem; qty: number }>;
  }>;
}

function calculateTotal(items: ReadonlyArray<OrderItem>): number {
  return items.reduce((sum, oi) => sum + oi.item.price * oi.qty, 0);
}

export class PgStore implements Store {
  private readonly dataFilePath: string;
  private menu: MenuItem[] = [];
  private menuVersions: MenuItemVersion[] = [];
  private menuSnapshots: MenuSnapshot[] = [];
  private orders: Order[] = [];
  private userRoles = new Map<string, Role[]>();
  private userNames = new Map<string, string>();
  private roleRequests: RoleRequest[] = [];

  constructor(options: PgStoreOptions = {}) {
    this.dataFilePath = options.dataFilePath ?? "./data/store.json";
  }

  async init(): Promise<void> {
    await db.execute(sql`select 1`);
    await this.seedFromJsonIfEmpty();
    await this.ensureMenuVersions();
    await this.ensureMenuSnapshots();
    await this.reloadFromDatabase();
  }

  // ── Menu ────────────────────────────────────────────────────

  getMenu(): ReadonlyArray<MenuItem> {
    return this.menu.map((item) => this.withPriceChangeHint(item));
  }

  getMenuItemHistory(menuId: number): ReadonlyArray<MenuItemVersion> {
    return this.menuVersions
      .filter((version) => version.menuItemId === menuId)
      .sort((a, b) => b.version - a.version);
  }

  async createMenuItem(input: {
    name: string;
    price: number;
    category: string;
    description: string;
    image_url: string;
  }): Promise<MenuItem> {
    const [inserted] = await db
      .insert(menuItemsTable)
      .values({
        name: input.name,
        price: input.price,
        category: input.category,
        description: input.description,
        imageUrl: input.image_url,
      })
      .returning();

    if (!inserted) throw new Error("Failed to insert menu item");

    const created: MenuItem = {
      id: inserted.id,
      name: inserted.name,
      price: inserted.price,
      category: inserted.category,
      description: inserted.description,
      image_url: inserted.imageUrl,
    };

    this.menu.push(created);
    await this.recordMenuVersion(created, "created");
    await this.recordMenuSnapshot("created", created.id);
    return this.withPriceChangeHint(created);
  }

  async updateMenuItem(
    menuId: number,
    patch: {
      name?: string;
      price?: number;
      category?: string;
      description?: string;
      image_url?: string;
    },
  ): Promise<MenuItem | null> {
    const [updated] = await db
      .update(menuItemsTable)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.price !== undefined ? { price: patch.price } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.image_url !== undefined ? { imageUrl: patch.image_url } : {}),
      })
      .where(eq(menuItemsTable.id, menuId))
      .returning();

    if (!updated) return null;

    const next: MenuItem = {
      id: updated.id,
      name: updated.name,
      price: updated.price,
      category: updated.category,
      description: updated.description,
      image_url: updated.imageUrl,
    };

    const idx = this.menu.findIndex((item) => item.id === menuId);
    if (idx !== -1) this.menu[idx] = next;

    await this.recordMenuVersion(next, "updated");
    await this.recordMenuSnapshot("updated", next.id);
    return this.withPriceChangeHint(next);
  }

  getMenuReleases(): ReadonlyArray<MenuSnapshot> {
    return [...this.menuSnapshots].sort((a, b) => b.version - a.version);
  }

  getMenuRelease(version: number): MenuSnapshot | undefined {
    return this.menuSnapshots.find((snapshot) => snapshot.version === version);
  }

  async deleteMenuItem(menuId: number): Promise<MenuItem | null> {
    const [removed] = await db
      .delete(menuItemsTable)
      .where(eq(menuItemsTable.id, menuId))
      .returning();

    if (!removed) return null;

    const removedItem: MenuItem = {
      id: removed.id,
      name: removed.name,
      price: removed.price,
      category: removed.category,
      description: removed.description,
      image_url: removed.imageUrl,
    };

    await this.recordMenuVersion(removedItem, "deleted");

    const idx = this.menu.findIndex((item) => item.id === menuId);
    if (idx !== -1) this.menu.splice(idx, 1);
    await this.recordMenuSnapshot("deleted", removedItem.id);

    return removedItem;
  }

  getUserRoles(userId: string): ReadonlyArray<Role> {
    return this.userRoles.get(userId) ?? ["customer"];
  }

  async userExists(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (row) this.userNames.set(row.id, row.name);
    return Boolean(row);
  }

  async findUserByEmail(
    email: string,
  ): Promise<{ id: string; name: string; email: string } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const [row] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(sql`lower(${user.email}) = ${normalizedEmail}`)
      .limit(1);

    if (!row) return null;
    this.userNames.set(row.id, row.name);
    return row;
  }

  async setUserRoles(
    userId: string,
    roles: ReadonlyArray<Role>,
  ): Promise<Role[]> {
    const normalizedRoles = normalizeRoles(roles);

    await db.delete(userRolesTable).where(eq(userRolesTable.userId, userId));
    await db.insert(userRolesTable).values(
      normalizedRoles.map((role) => ({
        userId,
        role,
      })),
    );

    this.userRoles.set(userId, normalizedRoles);
    return normalizedRoles;
  }

  async deleteUserRole(userId: string, role: Role): Promise<Role[]> {
    await db
      .delete(userRolesTable)
      .where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.role, role)));

    const nextRoles = this
      .getUserRoles(userId)
      .filter((currentRole) => currentRole !== role);
    const normalizedRoles = normalizeRoles(nextRoles);

    if (normalizedRoles.includes("customer") && nextRoles.length === 0) {
      await db
        .insert(userRolesTable)
        .values({ userId, role: "customer" })
        .onConflictDoNothing();
    }

    this.userRoles.set(userId, normalizedRoles);
    return normalizedRoles;
  }

  async createRoleRequest(input: {
    user: CurrentUser;
    requestedRole: InternalRole;
    reason: string;
  }): Promise<RoleRequest> {
    const [inserted] = await db
      .insert(roleRequestsTable)
      .values({
        userId: input.user.id,
        userName: input.user.name,
        userEmail: input.user.email,
        requestedRole: input.requestedRole,
        reason: input.reason,
        status: "pending",
        createdAt: new Date(),
      })
      .returning();

    if (!inserted) throw new Error("Failed to create role request");

    const roleRequest = mapRoleRequestRow(inserted);
    this.roleRequests.push(roleRequest);

    return roleRequest;
  }

  hasPendingRoleRequest(
    userId: string,
    requestedRole: InternalRole,
  ): boolean {
    return this.roleRequests.some(
      (request) =>
        request.userId === userId &&
        request.requestedRole === requestedRole &&
        request.status === "pending",
    );
  }

  getRoleRequests(): ReadonlyArray<RoleRequest> {
    return this.roleRequests;
  }

  getRoleRequestById(requestId: number): RoleRequest | undefined {
    return this.roleRequests.find((request) => request.id === requestId);
  }

  async reviewRoleRequest(
    requestId: number,
    input: { action: "approve" | "reject"; reviewer: CurrentUser },
  ): Promise<RoleRequest | null> {
    const [updated] = await db
      .update(roleRequestsTable)
      .set({
        status: input.action === "approve" ? "approved" : "rejected",
        reviewedBy: input.reviewer.id,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(roleRequestsTable.id, requestId),
          eq(roleRequestsTable.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      return this.getRoleRequestById(requestId) ?? null;
    }

    const roleRequest = mapRoleRequestRow(updated);
    const existingIndex = this.roleRequests.findIndex(
      (request) => request.id === roleRequest.id,
    );
    if (existingIndex !== -1) this.roleRequests[existingIndex] = roleRequest;

    if (roleRequest.status === "approved") {
      await this.setUserRoles(roleRequest.userId, [
        ...this.getUserRoles(roleRequest.userId),
        roleRequest.requestedRole,
      ]);
    }

    return roleRequest;
  }

  // ── Orders ──────────────────────────────────────────────────

  getOrders(): ReadonlyArray<Order> {
    return this.orders;
  }

  getCurrentOrderByUserId(userId: string): Order | undefined {
    const pendingOrders = this.orders.filter(
      (o) => o.userId === userId && o.status === "pending",
    );

    if (pendingOrders.length === 0) return undefined;

    // 取最新 pending（id 越大越新），避免使用到舊的空購物車訂單。
    return pendingOrders.reduce((latest, current) =>
      current.id > latest.id ? current : latest,
    );
  }

  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order> {
    return this.orders
      .filter((o) => o.userId === userId && o.status === "submitted")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrderById(orderId: number): Order | undefined {
    return this.orders.find((o) => o.id === orderId);
  }

  async createOrder(input: {
    userId: string;
    createdByUserId?: string;
    createdOnBehalf?: boolean;
    reuseExisting?: boolean;
  }): Promise<Order> {
    const existingOrder = this.getCurrentOrderByUserId(input.userId);
    if (existingOrder && input.reuseExisting !== false) {
      return existingOrder;
    }

    const createdAt = new Date();

    const [inserted] = await db
      .insert(ordersTable)
      .values({
        userId: input.userId,
        createdByUserId: input.createdByUserId,
        createdOnBehalf: input.createdOnBehalf ?? false,
        status: "pending",
        total: 0,
        createdAt,
      })
      .returning();

    if (!inserted) throw new Error("Failed to create order");

    const order: Order = {
      id: inserted.id,
      userId: input.userId,
      customerName: this.userNames.get(input.userId),
      createdByUserId: inserted.createdByUserId ?? undefined,
      createdOnBehalf: inserted.createdOnBehalf,
      items: [],
      total: inserted.total,
      status: "pending",
      createdAt:
        inserted.createdAt instanceof Date
          ? inserted.createdAt.toISOString()
          : new Date(inserted.createdAt).toISOString(),
    };

    this.orders.push(order);
    return order;
  }

  async updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      itemId: number;
      qty: number;
      canEditAnyOrder?: boolean;
    },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "MENU_ITEM_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE";
      }
  > {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
    if (order.userId !== input.userId && !input.canEditAnyOrder)
      return { ok: false, code: "ORDER_NOT_OWNED" };
    if (order.status !== "pending")
      return { ok: false, code: "ORDER_NOT_EDITABLE" };

    const menuItem = this.menu.find((item) => item.id === input.itemId);
    if (!menuItem) return { ok: false, code: "MENU_ITEM_NOT_FOUND" };

    const existingIdx = order.items.findIndex(
      (oi) => oi.item.id === input.itemId,
    );

    if (existingIdx !== -1) {
      if (input.qty === 0) {
        await db
          .delete(orderItemsTable)
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              eq(orderItemsTable.itemId, input.itemId),
            ),
          );
        order.items.splice(existingIdx, 1);
      } else {
        await db
          .update(orderItemsTable)
          .set({ qty: input.qty })
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              eq(orderItemsTable.itemId, input.itemId),
            ),
          );
        const target = order.items[existingIdx];
        if (target) target.qty = input.qty;
      }
    } else if (input.qty > 0) {
      await db.insert(orderItemsTable).values({
        orderId,
        itemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        category: menuItem.category,
        description: menuItem.description,
        imageUrl: menuItem.image_url,
        qty: input.qty,
      });
      order.items.push({ item: { ...menuItem }, qty: input.qty });
    }

    order.total = calculateTotal(order.items);
    await db
      .update(ordersTable)
      .set({ total: order.total })
      .where(eq(ordersTable.id, orderId));

    return { ok: true, order };
  }

  async submitOrder(
    orderId: number,
    input: { userId: string; canSubmitAnyOrder?: boolean },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE"
          | "EMPTY_ORDER";
      }
  > {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
    if (order.userId !== input.userId && !input.canSubmitAnyOrder)
      return { ok: false, code: "ORDER_NOT_OWNED" };
    if (order.status !== "pending")
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    if (order.items.length === 0) return { ok: false, code: "EMPTY_ORDER" };

    const submittedAt = new Date().toISOString();

    await db
      .update(ordersTable)
      .set({ status: "submitted", submittedAt: new Date(submittedAt) })
      .where(eq(ordersTable.id, orderId));

    order.status = "submitted";
    order.submittedAt = submittedAt;

    return { ok: true, order };
  }

  async updateOrderStatus(
    orderId: number,
    input: { status: Exclude<OrderStatus, "pending"> },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code: "ORDER_NOT_FOUND";
      }
  > {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };

    const submittedAt = order.submittedAt ?? new Date().toISOString();

    await db
      .update(ordersTable)
      .set({ status: input.status, submittedAt: new Date(submittedAt) })
      .where(eq(ordersTable.id, orderId));

    order.status = input.status;
    order.submittedAt = submittedAt;

    return { ok: true, order };
  }

  // ── Private ─────────────────────────────────────────────────

  private async seedFromJsonIfEmpty(): Promise<void> {
    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(menuItemsTable);

    if (Number(countRow?.value ?? 0) > 0) return;

    const file = Bun.file(this.dataFilePath);
    if (!(await file.exists())) return;

    const parsed = JSON.parse(await file.text()) as SeedData;
    const menu = Array.isArray(parsed.menu) ? parsed.menu : [];

    if (menu.length > 0) {
      await db.insert(menuItemsTable).values(
        menu.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          description: item.description,
          imageUrl: item.image_url,
        })),
      );
    }

    // V9: 不再播 orders seed data（orders 的 user_id FK 指向 Better Auth user 表，
    // seed JSON 中的舊 userId 在 bf_v9.user 不存在，強制播入會觸發 FK violation）

    const schema = process.env.PG_SCHEMA ?? "public";
    await db.execute(
      sql.raw(
        `select setval('${schema}.menu_items_id_seq', coalesce((select max(id) from ${schema}.menu_items), 1), true)`,
      ),
    );
  }

  private async ensureMenuVersions(): Promise<void> {
    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(menuItemVersionsTable);

    if (Number(countRow?.value ?? 0) > 0) return;

    const menuRows = await db
      .select()
      .from(menuItemsTable)
      .orderBy(asc(menuItemsTable.id));

    if (menuRows.length === 0) return;

    const changedAt = new Date();
    await db.insert(menuItemVersionsTable).values(
      menuRows.map((row) => ({
        menuItemId: row.id,
        version: 1,
        action: "created",
        name: row.name,
        price: row.price,
        category: row.category,
        description: row.description,
        imageUrl: row.imageUrl,
        changedAt,
      })),
    );
  }

  private async ensureMenuSnapshots(): Promise<void> {
    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(menuSnapshotsTable);

    if (Number(countRow?.value ?? 0) > 0) return;

    const menuRows = await db
      .select()
      .from(menuItemsTable)
      .orderBy(asc(menuItemsTable.id));

    const items: MenuItem[] = menuRows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      category: row.category,
      description: row.description,
      image_url: row.imageUrl,
    }));

    await db.insert(menuSnapshotsTable).values({
      version: 1,
      action: "initial",
      items,
      createdAt: new Date(),
    });
  }

  private async reloadFromDatabase(): Promise<void> {
    const menuRows = await db
      .select()
      .from(menuItemsTable)
      .orderBy(asc(menuItemsTable.id));

    const orderRows = await db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id));

    const orderItemRows = await db
      .select()
      .from(orderItemsTable)
      .orderBy(asc(orderItemsTable.id));

    const userRoleRows = await db
      .select()
      .from(userRolesTable)
      .orderBy(asc(userRolesTable.userId));

    const roleRequestRows = await db
      .select()
      .from(roleRequestsTable)
      .orderBy(desc(roleRequestsTable.createdAt), desc(roleRequestsTable.id));

    const userRows = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .orderBy(asc(user.id));

    const menuVersionRows = await db
      .select()
      .from(menuItemVersionsTable)
      .orderBy(asc(menuItemVersionsTable.menuItemId), asc(menuItemVersionsTable.version));
    const menuSnapshotRows = await db
      .select()
      .from(menuSnapshotsTable)
      .orderBy(asc(menuSnapshotsTable.version));

    this.menu = menuRows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      category: row.category,
      description: row.description,
      image_url: row.imageUrl,
    }));

    this.menuVersions = menuVersionRows.map((row) => mapMenuVersionRow(row));
    this.menuSnapshots = menuSnapshotRows.map((row) => mapMenuSnapshotRow(row));

    const itemsByOrderId = new Map<number, OrderItem[]>();
    for (const row of orderItemRows) {
      const items = itemsByOrderId.get(row.orderId) ?? [];
      items.push({
        item: {
          id: row.itemId,
          name: row.name,
          price: row.price,
          category: row.category,
          description: row.description,
          image_url: row.imageUrl,
        },
        qty: row.qty,
      });
      itemsByOrderId.set(row.orderId, items);
    }

    this.userNames = new Map(userRows.map((row) => [row.id, row.name]));

    this.orders = orderRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      customerName: this.userNames.get(row.userId),
      createdByUserId: row.createdByUserId ?? undefined,
      createdOnBehalf: row.createdOnBehalf,
      items: itemsByOrderId.get(row.id) ?? [],
      total: row.total,
      status: asOrderStatus(row.status),
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt).toISOString(),
      submittedAt: row.submittedAt
        ? row.submittedAt instanceof Date
          ? row.submittedAt.toISOString()
          : new Date(row.submittedAt).toISOString()
        : undefined,
    }));

    this.userRoles = new Map<string, Role[]>();
    for (const row of userRoleRows) {
      const roles = this.userRoles.get(row.userId) ?? [];
      roles.push(asRole(row.role));
      this.userRoles.set(row.userId, normalizeRoles(roles));
    }

    this.roleRequests = roleRequestRows.map((row) => mapRoleRequestRow(row));
  }

  private async recordMenuVersion(
    item: MenuItem,
    action: MenuItemVersion["action"],
  ): Promise<void> {
    const currentMaxVersion = this.menuVersions
      .filter((version) => version.menuItemId === item.id)
      .reduce((max, version) => Math.max(max, version.version), 0);

    const [inserted] = await db
      .insert(menuItemVersionsTable)
      .values({
        menuItemId: item.id,
        version: currentMaxVersion + 1,
        action,
        name: item.name,
        price: item.price,
        category: item.category,
        description: item.description,
        imageUrl: item.image_url,
        changedAt: new Date(),
      })
      .returning();

    if (inserted) {
      this.menuVersions.push(mapMenuVersionRow(inserted));
    }
  }

  private async recordMenuSnapshot(
    action: Exclude<MenuSnapshot["action"], "initial">,
    changedMenuItemId: number,
  ): Promise<void> {
    const version =
      this.menuSnapshots.reduce(
        (max, snapshot) => Math.max(max, snapshot.version),
        0,
      ) + 1;

    const [inserted] = await db
      .insert(menuSnapshotsTable)
      .values({
        version,
        action,
        changedMenuItemId,
        items: this.menu.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          description: item.description,
          image_url: item.image_url,
        })),
        createdAt: new Date(),
      })
      .returning();

    if (inserted) this.menuSnapshots.push(mapMenuSnapshotRow(inserted));
  }

  private withPriceChangeHint(item: MenuItem): MenuItem {
    const history = this.menuVersions
      .filter((version) => version.menuItemId === item.id)
      .sort((a, b) => a.version - b.version);
    const latest = history.at(-1);
    const previous = history.at(-2);

    if (!latest) return { ...item };

    const priceDelta =
      previous && latest.snapshot.price !== previous.snapshot.price
        ? latest.snapshot.price - previous.snapshot.price
        : undefined;

    return {
      ...item,
      version: latest.version,
      lastChangedAt: latest.changedAt,
      previousPrice: priceDelta === undefined ? undefined : previous?.snapshot.price,
      priceDelta,
    };
  }
}

function normalizeRoles(roles: ReadonlyArray<Role>): Role[] {
  const normalized = [...new Set<Role>(roles)];
  return normalized.length > 0 ? normalized : ["customer"];
}

function asRole(role: string): Role {
  return role === "staff" ||
    role === "chef" ||
    role === "owner" ||
    role === "admin"
    ? role
    : "customer";
}

function asInternalRole(role: string): InternalRole {
  return role === "chef" || role === "owner" ? role : "staff";
}

function asOrderStatus(status: string): OrderStatus {
  return status === "submitted" ||
    status === "preparing" ||
    status === "ready" ||
    status === "completed" ||
    status === "cancelled"
    ? status
    : "pending";
}

function mapRoleRequestRow(
  row: typeof roleRequestsTable.$inferSelect,
): RoleRequest {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    requestedRole: asInternalRole(row.requestedRole),
    reason: row.reason,
    status:
      row.status === "approved" || row.status === "rejected"
        ? row.status
        : "pending",
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt
      ? new Date(row.reviewedAt).toISOString()
      : undefined,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function mapMenuVersionRow(
  row: typeof menuItemVersionsTable.$inferSelect,
): MenuItemVersion {
  const action =
    row.action === "updated" || row.action === "deleted"
      ? row.action
      : "created";

  return {
    id: row.id,
    menuItemId: row.menuItemId,
    version: row.version,
    action,
    snapshot: {
      id: row.menuItemId,
      name: row.name,
      price: row.price,
      category: row.category,
      description: row.description,
      image_url: row.imageUrl,
    },
    changedAt: new Date(row.changedAt).toISOString(),
  };
}

function mapMenuSnapshotRow(
  row: typeof menuSnapshotsTable.$inferSelect,
): MenuSnapshot {
  const action =
    row.action === "created" ||
    row.action === "updated" ||
    row.action === "deleted"
      ? row.action
      : "initial";

  return {
    id: row.id,
    version: row.version,
    action,
    changedMenuItemId: row.changedMenuItemId ?? undefined,
    items: row.items as MenuItem[],
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
