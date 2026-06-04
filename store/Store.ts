import type {
  CurrentUser,
  InternalRole,
  MenuItem,
  Order,
  OrderStatus,
  Role,
  RoleRequest,
} from "../shared/contracts.ts";

export type UpdateOrderItemErrorCode =
  | "ORDER_NOT_FOUND"
  | "MENU_ITEM_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE";

export type SubmitOrderErrorCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE"
  | "EMPTY_ORDER";

export type UpdateOrderStatusErrorCode = "ORDER_NOT_FOUND";

export interface Store {
  init(): Promise<void>;

  getMenu(): ReadonlyArray<MenuItem>;
  createMenuItem(input: {
    name: string;
    price: number;
    category: string;
    description: string;
    image_url: string;
  }): Promise<MenuItem>;
  updateMenuItem(
    menuId: number,
    patch: {
      name?: string;
      price?: number;
      category?: string;
      description?: string;
      image_url?: string;
    },
  ): Promise<MenuItem | null>;
  deleteMenuItem(menuId: number): Promise<MenuItem | null>;

  getUserRoles(userId: string): ReadonlyArray<Role>;
  setUserRoles(userId: string, roles: ReadonlyArray<Role>): Promise<Role[]>;
  createRoleRequest(input: {
    user: CurrentUser;
    requestedRole: InternalRole;
    reason: string;
  }): Promise<RoleRequest>;
  getRoleRequests(): ReadonlyArray<RoleRequest>;
  getRoleRequestById(requestId: number): RoleRequest | undefined;
  reviewRoleRequest(
    requestId: number,
    input: { action: "approve" | "reject"; reviewer: CurrentUser },
  ): Promise<RoleRequest | null>;

  getOrders(): ReadonlyArray<Order>;
  getCurrentOrderByUserId(userId: string): Order | undefined;
  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order>;
  getOrderById(orderId: number): Order | undefined;
  createOrder(input: { userId: string }): Promise<Order>;
  updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      itemId: number;
      qty: number;
    },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: UpdateOrderItemErrorCode }
  >;
  submitOrder(
    orderId: number,
    input: { userId: string },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: SubmitOrderErrorCode }
  >;
  updateOrderStatus(
    orderId: number,
    input: { status: Exclude<OrderStatus, "pending"> },
  ): Promise<
    | { ok: true; order: Order }
    | { ok: false; code: UpdateOrderStatusErrorCode }
  >;
}
