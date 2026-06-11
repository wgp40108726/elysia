import { mkdir, rename } from "node:fs/promises";
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
import type { Store } from "../Store.ts";

interface StoredUser {
  id: string;
  email: string;
  name: string;
  password: string;
  roles: Role[];
}

interface DataStore {
  users: StoredUser[];
  menu: MenuItem[];
  menuVersions: MenuItemVersion[];
  menuSnapshots: MenuSnapshot[];
  orders: Order[];
  roleRequests: RoleRequest[];
  userIdCounter: number;
  menuIdCounter: number;
  menuVersionIdCounter: number;
  menuSnapshotIdCounter: number;
  orderIdCounter: number;
  roleRequestIdCounter: number;
}

interface JsonFileStoreOptions {
  dataFilePath: string;
}

const defaultMenu: MenuItem[] = [
  {
    id: 1,
    name: "火腿蛋吐司",
    price: 40,
    category: "餐點",
    description: "現煎雞蛋搭配火腿與生菜，使用微烤白吐司，口感清爽不油膩。",
    image_url: "/imgs/menu/ham-egg-toast.webp",
  },
  {
    id: 2,
    name: "起司豬排堡",
    price: 65,
    category: "餐點",
    description: "厚切豬排搭配起司與生菜，外酥內嫩，適合喜歡有咬勁的你。",
    image_url: "/imgs/menu/cheese-pork-burger.webp",
  },
  {
    id: 3,
    name: "鮪魚蛋吐司",
    price: 45,
    category: "餐點",
    description: "自調鮪魚沙拉配上煎蛋與生菜，口味濃郁但不會太鹹。",
    image_url: "/imgs/menu/tuna-egg-toast.webp",
  },
  {
    id: 4,
    name: "培根蛋餅",
    price: 45,
    category: "餐點",
    description: "煎到微酥的蛋餅皮包裹煙燻培根與雞蛋，是經典台式早餐選擇。",
    image_url: "/imgs/menu/bacon-egg-roll.webp",
  },
];

function cloneDefaultMenu(): MenuItem[] {
  return defaultMenu.map((item) => ({ ...item }));
}

function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, orderItem) => {
    return sum + orderItem.item.price * orderItem.qty;
  }, 0);
}

function normalizeMenuItem(item: Partial<MenuItem>): MenuItem {
  return {
    id: item.id ?? 0,
    name: item.name ?? "",
    price: item.price ?? 0,
    category: item.category ?? "",
    description: item.description ?? "",
    image_url: item.image_url ?? "",
  };
}

function normalizeUserId(rawId: unknown): string {
  if (typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0) {
    return String(rawId).padStart(4, "0");
  }

  if (typeof rawId === "string" && rawId.trim() !== "") {
    const trimmed = rawId.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed.padStart(4, "0");
    }
    return trimmed;
  }

  return "0001";
}

function normalizeUser(user: Partial<StoredUser>): StoredUser {
  return {
    id: normalizeUserId(user.id),
    email: user.email ?? "",
    name: user.name ?? "",
    password: user.password ?? "",
    roles: normalizeRoles(user.roles),
  };
}

function toMenuSnapshot(item: MenuItem): MenuItemVersion["snapshot"] {
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    category: item.category,
    description: item.description,
    image_url: item.image_url,
  };
}

function normalizeMenuVersion(
  version: Partial<MenuItemVersion>,
): MenuItemVersion {
  const action =
    version.action === "updated" || version.action === "deleted"
      ? version.action
      : "created";
  const snapshot = normalizeMenuItem(version.snapshot ?? {});

  return {
    id: version.id ?? 0,
    menuItemId: version.menuItemId ?? snapshot.id,
    version: version.version ?? 1,
    action,
    snapshot: toMenuSnapshot(snapshot),
    changedAt: version.changedAt ?? new Date().toISOString(),
  };
}

function createInitialMenuVersions(
  menu: ReadonlyArray<MenuItem>,
): MenuItemVersion[] {
  const seedTime = new Date().toISOString();
  return menu.map((item, index) => ({
    id: index + 1,
    menuItemId: item.id,
    version: 1,
    action: "created",
    snapshot: toMenuSnapshot(item),
    changedAt: seedTime,
  }));
}

function createInitialMenuSnapshot(menu: ReadonlyArray<MenuItem>): MenuSnapshot {
  return {
    id: 1,
    version: 1,
    action: "initial",
    items: menu.map(toMenuSnapshot),
    createdAt: new Date().toISOString(),
  };
}

function normalizeRoles(roles: unknown): Role[] {
  if (!Array.isArray(roles)) return ["customer"];

  const validRoles = new Set<Role>([
    "customer",
    "staff",
    "chef",
    "owner",
    "admin",
  ]);
  const normalized = roles.filter((role): role is Role => validRoles.has(role));

  return normalized.length > 0
    ? [...new Set<Role>(normalized)]
    : ["customer"];
}

function normalizeRoleRequest(request: Partial<RoleRequest>): RoleRequest {
  const requestedRole: InternalRole =
    request.requestedRole === "staff" ||
    request.requestedRole === "chef" ||
    request.requestedRole === "owner"
      ? request.requestedRole
      : "staff";

  const status =
    request.status === "approved" || request.status === "rejected"
      ? request.status
      : "pending";

  return {
    id: request.id ?? 0,
    userId: request.userId ?? "",
    userName: request.userName ?? "",
    userEmail: request.userEmail ?? "",
    requestedRole,
    reason: request.reason ?? "",
    status,
    reviewedBy: request.reviewedBy,
    reviewedAt: request.reviewedAt,
    createdAt: request.createdAt ?? new Date().toISOString(),
  };
}

function normalizeOrderStatus(status: unknown): OrderStatus {
  return status === "submitted" ||
    status === "preparing" ||
    status === "ready" ||
    status === "completed" ||
    status === "cancelled"
    ? status
    : "pending";
}

const defaultUsers: StoredUser[] = [
  {
    id: "0001",
    email: "demo@example.com",
    name: "示範使用者",
    password: "1234",
    roles: ["customer", "admin"],
  },
  {
    id: "0002",
    email: "amy@example.com",
    name: "Amy",
    password: "1234",
    roles: ["customer"],
  },
];

function cloneDefaultUsers(): StoredUser[] {
  return defaultUsers.map((user) => ({ ...user }));
}

export class JsonFileStore implements Store {
  private readonly dataFilePath: string;

  private users: StoredUser[] = [];
  private menu: MenuItem[] = [];
  private menuVersions: MenuItemVersion[] = [];
  private menuSnapshots: MenuSnapshot[] = [];
  private orders: Order[] = [];
  private roleRequests: RoleRequest[] = [];
  private userIdCounter = 0;
  private menuIdCounter = 0;
  private menuVersionIdCounter = 0;
  private menuSnapshotIdCounter = 0;
  private orderIdCounter = 0;
  private roleRequestIdCounter = 0;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonFileStoreOptions) {
    this.dataFilePath = options.dataFilePath;
  }

  async init(): Promise<void> {
    const file = Bun.file(this.dataFilePath);

    if (!(await file.exists())) {
      const initialStore = this.createInitialStore();
      this.applyStore(initialStore);
      await this.saveStore(initialStore);
      return;
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<DataStore>;

      if (!Array.isArray(parsed.menu) || !Array.isArray(parsed.orders)) {
        throw new Error("Invalid store schema");
      }

      const normalizedUsers = Array.isArray(parsed.users)
        ? parsed.users.map((user) => normalizeUser(user))
        : cloneDefaultUsers();

      const fallbackUserId = normalizedUsers[0]?.id ?? "0001";

      const normalizedMenu = parsed.menu.map((item) => normalizeMenuItem(item));
      const normalizedMenuVersions = Array.isArray(parsed.menuVersions)
        ? parsed.menuVersions.map((version) => normalizeMenuVersion(version))
        : createInitialMenuVersions(normalizedMenu);
      const normalizedMenuSnapshots = Array.isArray(parsed.menuSnapshots)
        ? parsed.menuSnapshots
        : [createInitialMenuSnapshot(normalizedMenu)];

      this.applyStore({
        users: normalizedUsers,
        menu: normalizedMenu,
        menuVersions: normalizedMenuVersions,
        menuSnapshots: normalizedMenuSnapshots,
        orders: parsed.orders.map((order) => ({
          ...order,
          userId: normalizeUserId(order.userId ?? fallbackUserId),
          customerName:
            normalizedUsers.find(
              (user) =>
                user.id === normalizeUserId(order.userId ?? fallbackUserId),
            )?.name ?? order.customerName,
          createdByUserId: order.createdByUserId
            ? normalizeUserId(order.createdByUserId)
            : undefined,
          createdOnBehalf: order.createdOnBehalf ?? false,
          items: order.items.map((orderItem) => ({
            ...orderItem,
            item: normalizeMenuItem(orderItem.item),
          })),
          status: normalizeOrderStatus(order.status),
          submittedAt: order.submittedAt,
        })),
        roleRequests: Array.isArray(parsed.roleRequests)
          ? parsed.roleRequests.map((request) => normalizeRoleRequest(request))
          : [],
        userIdCounter: parsed.userIdCounter ?? 0,
        menuIdCounter: parsed.menuIdCounter ?? 0,
        menuVersionIdCounter: parsed.menuVersionIdCounter ?? 0,
        menuSnapshotIdCounter: parsed.menuSnapshotIdCounter ?? 0,
        orderIdCounter: parsed.orderIdCounter ?? 0,
        roleRequestIdCounter: parsed.roleRequestIdCounter ?? 0,
      });
    } catch (error) {
      console.warn("[store] load failed, fallback to initial store", error);
      const initialStore = this.createInitialStore();
      this.applyStore(initialStore);
      await this.saveStore(initialStore);
    }
  }

  getMenu(): ReadonlyArray<MenuItem> {
    return this.menu.map((item) => this.withPriceChangeHint(item));
  }

  getMenuItemHistory(menuId: number): ReadonlyArray<MenuItemVersion> {
    return this.menuVersions
      .filter((version) => version.menuItemId === menuId)
      .sort((a, b) => b.version - a.version);
  }

  getMenuReleases(): ReadonlyArray<MenuSnapshot> {
    return [...this.menuSnapshots].sort((a, b) => b.version - a.version);
  }

  getMenuRelease(version: number): MenuSnapshot | undefined {
    return this.menuSnapshots.find((snapshot) => snapshot.version === version);
  }

  async createMenuItem(input: {
    name: string;
    price: number;
    category: string;
    description: string;
    image_url: string;
  }): Promise<MenuItem> {
    const newMenuItem: MenuItem = {
      id: ++this.menuIdCounter,
      name: input.name,
      price: input.price,
      category: input.category,
      description: input.description,
      image_url: input.image_url,
    };

    this.menu.push(newMenuItem);
    this.recordMenuVersion(newMenuItem, "created");
    this.recordMenuSnapshot("created", newMenuItem.id);
    await this.persist();

    return newMenuItem;
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
    const menuItem = this.menu.find((item) => item.id === menuId);
    if (!menuItem) {
      return null;
    }

    menuItem.name = patch.name ?? menuItem.name;
    menuItem.price = patch.price ?? menuItem.price;
    menuItem.category = patch.category ?? menuItem.category;
    menuItem.description = patch.description ?? menuItem.description;
    menuItem.image_url = patch.image_url ?? menuItem.image_url;

    this.recordMenuVersion(menuItem, "updated");
    this.recordMenuSnapshot("updated", menuItem.id);
    await this.persist();

    return this.withPriceChangeHint(menuItem);
  }

  async deleteMenuItem(menuId: number): Promise<MenuItem | null> {
    const targetIndex = this.menu.findIndex((item) => item.id === menuId);
    if (targetIndex === -1) {
      return null;
    }

    const [removedMenuItem] = this.menu.splice(targetIndex, 1);
    if (removedMenuItem) {
      this.recordMenuVersion(removedMenuItem, "deleted");
      this.recordMenuSnapshot("deleted", removedMenuItem.id);
    }
    await this.persist();

    return removedMenuItem ?? null;
  }

  getUserRoles(userId: string): ReadonlyArray<Role> {
    return this.users.find((user) => user.id === userId)?.roles ?? ["customer"];
  }

  async userExists(userId: string): Promise<boolean> {
    return this.users.some((user) => user.id === userId);
  }

  async findUserByEmail(
    email: string,
  ): Promise<{ id: string; name: string; email: string } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const matchedUser = this.users.find(
      (user) => user.email.trim().toLowerCase() === normalizedEmail,
    );

    return matchedUser
      ? {
          id: matchedUser.id,
          name: matchedUser.name,
          email: matchedUser.email,
        }
      : null;
  }

  async setUserRoles(
    userId: string,
    roles: ReadonlyArray<Role>,
  ): Promise<Role[]> {
    const normalizedRoles = normalizeRoles(roles);
    const user = this.users.find((targetUser) => targetUser.id === userId);

    if (user) {
      user.roles = normalizedRoles;
    } else {
      this.users.push({
        id: userId,
        email: "",
        name: userId,
        password: "",
        roles: normalizedRoles,
      });
    }

    await this.persist();
    return normalizedRoles;
  }

  async deleteUserRole(userId: string, role: Role): Promise<Role[]> {
    const currentRoles = this.getUserRoles(userId);
    const nextRoles = currentRoles.filter((currentRole) => currentRole !== role);
    const normalizedRoles: Role[] =
      nextRoles.length > 0 ? nextRoles : ["customer"];

    return this.setUserRoles(userId, normalizedRoles);
  }

  async createRoleRequest(input: {
    user: CurrentUser;
    requestedRole: InternalRole;
    reason: string;
  }): Promise<RoleRequest> {
    const roleRequest: RoleRequest = {
      id: ++this.roleRequestIdCounter,
      userId: input.user.id,
      userName: input.user.name,
      userEmail: input.user.email,
      requestedRole: input.requestedRole,
      reason: input.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.roleRequests.push(roleRequest);
    await this.persist();

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
    const request = this.roleRequests.find((target) => target.id === requestId);
    if (!request) return null;

    if (request.status === "pending") {
      request.status = input.action === "approve" ? "approved" : "rejected";
      request.reviewedBy = input.reviewer.id;
      request.reviewedAt = new Date().toISOString();

      if (request.status === "approved") {
        const currentRoles = this.getUserRoles(request.userId);
        await this.setUserRoles(request.userId, [
          ...currentRoles,
          request.requestedRole,
        ]);
      } else {
        await this.persist();
      }
    }

    return request;
  }

  getOrders(): ReadonlyArray<Order> {
    return this.orders;
  }

  getCurrentOrderByUserId(userId: string): Order | undefined {
    const pendingOrders = this.orders.filter(
      (order) => order.userId === userId && order.status === "pending",
    );

    if (pendingOrders.length === 0) {
      return undefined;
    }

    // 取最新 pending（id 越大越新），避免拿到舊的空購物車訂單。
    return pendingOrders.reduce((latest, current) =>
      current.id > latest.id ? current : latest,
    );
  }

  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order> {
    return this.orders
      .filter(
        (order) => order.userId === userId && order.status === "submitted",
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrderById(orderId: number): Order | undefined {
    return this.orders.find((order) => order.id === orderId);
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

    const newOrder: Order = {
      id: ++this.orderIdCounter,
      userId: input.userId,
      customerName: this.users.find((user) => user.id === input.userId)?.name,
      createdByUserId: input.createdByUserId,
      createdOnBehalf: input.createdOnBehalf ?? false,
      items: [],
      total: 0,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.orders.push(newOrder);
    await this.persist();

    return newOrder;
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
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    if (order.userId !== input.userId && !input.canEditAnyOrder) {
      return { ok: false, code: "ORDER_NOT_OWNED" };
    }

    if (order.status !== "pending") {
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    }

    const menuItem = this.menu.find((item) => item.id === input.itemId);
    if (!menuItem) {
      return { ok: false, code: "MENU_ITEM_NOT_FOUND" };
    }

    const existingItemIndex = order.items.findIndex(
      (orderItem) => orderItem.item.id === input.itemId,
    );

    if (existingItemIndex !== -1) {
      const existingOrderItem = order.items[existingItemIndex];

      if (input.qty === 0) {
        order.items.splice(existingItemIndex, 1);
      } else if (existingOrderItem) {
        existingOrderItem.qty = input.qty;
      }
    } else if (input.qty > 0) {
      order.items.push({ item: menuItem, qty: input.qty });
    }

    order.total = calculateOrderTotal(order.items);
    await this.persist();

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
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    if (order.userId !== input.userId && !input.canSubmitAnyOrder) {
      return { ok: false, code: "ORDER_NOT_OWNED" };
    }

    if (order.status !== "pending") {
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    }

    if (order.items.length === 0) {
      return { ok: false, code: "EMPTY_ORDER" };
    }

    order.status = "submitted";
    order.submittedAt = new Date().toISOString();
    await this.persist();

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
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    order.status = input.status;
    if (!order.submittedAt) {
      order.submittedAt = new Date().toISOString();
    }

    await this.persist();
    return { ok: true, order };
  }

  private createInitialStore(): DataStore {
    return {
      users: cloneDefaultUsers(),
      menu: cloneDefaultMenu(),
      menuVersions: createInitialMenuVersions(cloneDefaultMenu()),
      menuSnapshots: [createInitialMenuSnapshot(cloneDefaultMenu())],
      orders: [],
      roleRequests: [],
      userIdCounter: defaultUsers.length,
      menuIdCounter: defaultMenu.length,
      menuVersionIdCounter: defaultMenu.length,
      menuSnapshotIdCounter: 1,
      orderIdCounter: 0,
      roleRequestIdCounter: 0,
    };
  }

  private applyStore(store: DataStore): void {
    this.users = store.users;
    this.menu = store.menu;
    this.menuVersions = store.menuVersions;
    this.menuSnapshots = store.menuSnapshots;
    this.orders = store.orders;
    this.roleRequests = store.roleRequests;

    const maxUserId = this.users.reduce((max, user) => {
      const asNumber = Number.parseInt(user.id, 10);
      return Number.isFinite(asNumber) ? Math.max(max, asNumber) : max;
    }, 0);

    const maxMenuId = this.menu.reduce(
      (max, item) => Math.max(max, item.id),
      0,
    );
    const maxMenuVersionId = this.menuVersions.reduce(
      (max, version) => Math.max(max, version.id),
      0,
    );
    const maxMenuSnapshotId = this.menuSnapshots.reduce(
      (max, snapshot) => Math.max(max, snapshot.id),
      0,
    );
    const maxOrderId = this.orders.reduce(
      (max, order) => Math.max(max, order.id),
      0,
    );
    const maxRoleRequestId = this.roleRequests.reduce(
      (max, request) => Math.max(max, request.id),
      0,
    );

    this.userIdCounter = Math.max(store.userIdCounter || 0, maxUserId);
    this.menuIdCounter = Math.max(store.menuIdCounter || 0, maxMenuId);
    this.menuVersionIdCounter = Math.max(
      store.menuVersionIdCounter || 0,
      maxMenuVersionId,
    );
    this.menuSnapshotIdCounter = Math.max(
      store.menuSnapshotIdCounter || 0,
      maxMenuSnapshotId,
    );
    this.orderIdCounter = Math.max(store.orderIdCounter || 0, maxOrderId);
    this.roleRequestIdCounter = Math.max(
      store.roleRequestIdCounter || 0,
      maxRoleRequestId,
    );
  }

  private buildStoreSnapshot(): DataStore {
    return {
      users: this.users,
      menu: this.menu,
      menuVersions: this.menuVersions,
      menuSnapshots: this.menuSnapshots,
      orders: this.orders,
      roleRequests: this.roleRequests,
      userIdCounter: this.userIdCounter,
      menuIdCounter: this.menuIdCounter,
      menuVersionIdCounter: this.menuVersionIdCounter,
      menuSnapshotIdCounter: this.menuSnapshotIdCounter,
      orderIdCounter: this.orderIdCounter,
      roleRequestIdCounter: this.roleRequestIdCounter,
    };
  }

  private recordMenuVersion(
    item: MenuItem,
    action: MenuItemVersion["action"],
  ): void {
    const currentMaxVersion = this.menuVersions
      .filter((version) => version.menuItemId === item.id)
      .reduce((max, version) => Math.max(max, version.version), 0);

    this.menuVersions.push({
      id: ++this.menuVersionIdCounter,
      menuItemId: item.id,
      version: currentMaxVersion + 1,
      action,
      snapshot: toMenuSnapshot(item),
      changedAt: new Date().toISOString(),
    });
  }

  private recordMenuSnapshot(
    action: Exclude<MenuSnapshot["action"], "initial">,
    changedMenuItemId: number,
  ): void {
    const version =
      this.menuSnapshots.reduce(
        (max, snapshot) => Math.max(max, snapshot.version),
        0,
      ) + 1;

    this.menuSnapshots.push({
      id: ++this.menuSnapshotIdCounter,
      version,
      action,
      changedMenuItemId,
      items: this.menu.map(toMenuSnapshot),
      createdAt: new Date().toISOString(),
    });
  }

  private withPriceChangeHint(item: MenuItem): MenuItem {
    const history = this.menuVersions
      .filter((version) => version.menuItemId === item.id)
      .sort((a, b) => a.version - b.version);
    const latest = history.at(-1);
    const previous = history.at(-2);

    if (!latest) {
      return { ...item };
    }

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

  private async saveStore(snapshot: DataStore): Promise<void> {
    await mkdir("./data", { recursive: true });
    const tmpPath = `${this.dataFilePath}.tmp`;
    await Bun.write(tmpPath, JSON.stringify(snapshot, null, 2));
    await rename(tmpPath, this.dataFilePath);
  }

  private async persist(): Promise<void> {
    const snapshot = this.buildStoreSnapshot();

    this.persistQueue = this.persistQueue.then(async () => {
      await this.saveStore(snapshot);
    });

    await this.persistQueue;
  }
}
