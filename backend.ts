import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { cors } from "@elysia/cors";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import toTaipeiDateTime from "./util.ts";
import {
  apiErrorResponseSchema,
  createRoleRequestBodySchema,
  createMenuItemBodySchema,
  currentUserResponseSchema,
  deleteMenuItemParamsSchema,
  getOrderByIdParamsSchema,
  healthResponseSchema,
  menuItemResponseSchema,
  menuListResponseSchema,
  nullableOrderResponseEnvelopeSchema,
  orderListResponseSchema,
  orderResponseEnvelopeSchema,
  permissionsResponseSchema,
  reviewRoleRequestBodySchema,
  roleRequestListResponseSchema,
  roleRequestParamsSchema,
  roleRequestResponseSchema,
  submitOrderParamsSchema,
  toOrderResponse,
  updateMenuItemBodySchema,
  updateMenuItemParamsSchema,
  updateOrderBodySchema,
  updateOrderParamsSchema,
  updateOrderStatusBodySchema,
  updateOrderStatusParamsSchema,
  updateUserRolesBodySchema,
  updateUserRolesParamsSchema,
  userRolesResponseSchema,
} from "./shared/route-schemas.ts";
import { createStore } from "./store/index.ts";
import { auth } from "./auth/better-auth.ts";
import {
  hasAnyRole,
  listPermissions,
  requireAnyRole,
  requireUser,
} from "./auth/guards.ts";

// 從環境變量獲取配置
const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0"; // 改為 0.0.0.0 以支持網路訪問
const allowedOrigin = process.env.API_ALLOWED_ORIGIN || "*";

// 獲取本機 IP 地址
function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
  }
  return "localhost";
}
const store = createStore({ dataFilePath: "./data/store.json" });
const hasPublicAssets =
  existsSync("./public") && existsSync("./public/index.html");

const app = new Elysia();

// ─── CORS Plugin ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin:
      allowedOrigin === "*" ? "*" : allowedOrigin || "http://localhost:5173",
    credentials: allowedOrigin !== "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── Better Auth Routes ───────────────────────────────────────────────────────
// ⚠️ 注意：不能使用 app.mount("/api/auth", auth.handler)
// 原因：Better Auth handler 是標準的 fetch handler function，
//       但 Elysia 的 .mount() 期望的是 Elysia instance 或特定格式的 handler。
//       測試結果：.mount() 會導致 404 錯誤。
//
// ✅ 正確做法：使用 wildcard 路由明確處理 GET 和 POST
// 必須在其他 API 路由之前定義，確保 Better Auth 路由優先匹配
app.get("/api/auth/*", ({ request }) => auth.handler(request));
app.post("/api/auth/*", ({ request }) => auth.handler(request));

app.get(
  "/api/me",
  async ({ request }) => {
    const user = await requireUser(request, store);
    return { data: user };
  },
  {
    detail: {
      tags: ["auth"],
      summary: "Get current user",
      description: "Return the authenticated user with RBAC roles.",
    },
    response: {
      200: currentUserResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/permissions/me",
  async ({ request }) => {
    const user = await requireUser(request, store);
    return {
      data: {
        roles: user.roles,
        permissions: listPermissions(user.roles),
      },
    };
  },
  {
    detail: {
      tags: ["auth"],
      summary: "Get current permissions",
      description: "Return RBAC roles and derived permissions for the user.",
    },
    response: {
      200: permissionsResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// ─── OpenAPI Plugin ───────────────────────────────────────────────────────────
app.use(
  openapi({
    path: "/openapi",
    specPath: "/openapi/json",
    documentation: {
      info: {
        title: "Breakfast Demo API",
        version: "0.2.3",
        description:
          "Breakfast ordering demo API for teaching route schema, contract-first design, and future database/auth upgrades. V9-clean-better-auth-v3: optimized static handling, CORS plugin, and Better Auth macro integration.",
      },
      tags: [
        { name: "auth", description: "Authentication endpoints" },
        { name: "menu", description: "Menu management endpoints" },
        { name: "orders", description: "Order query and mutation endpoints" },
        { name: "system", description: "System and health check endpoints" },
      ],
    },
    exclude: {
      staticFile: true,
      paths: ["/openapi", "/openapi/json"],
    },
  }),
);

// 請求記錄中間件
// ─── Request Logger ───────────────────────────────────────────────────────────
app.onRequest(({ request }) => {
  console.log(
    `[${toTaipeiDateTime(new Date().toISOString())}] ${request.method} ${new URL(request.url).pathname}`,
  );
});

// API 路由

// ─── Sign-out Proxy ───────────────────────────────────────────────────────────
// Better Auth 的 /api/auth/sign-out 有 CSRF origin 驗證（比對 trustedOrigins）。
// production 環境若 BETTER_AUTH_URL 設定錯誤（如仍是 localhost），
// 瀏覽器送出的 Origin（正式網址）不在白名單，導致 sign-out 回 403 但前端不知道，
// 造成「看似登出，實際 session 仍在」的假登出。
//
// 解法：在 Elysia 層加一個 proxy，以 server 信任的 baseURL 當 Origin 轉發給 Better Auth。
// 安全性：session 識別仍靠 cookie，CSRF bypass 只在 server 端發生，不降低安全性。
app.post("/api/sign-out", async ({ request }) => {
  const baBaseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

  // 複製原始 headers，強制覆寫 origin 為 Better Auth 信任的 baseURL
  const proxiedHeaders = new Headers(request.headers);
  proxiedHeaders.set("origin", baBaseUrl);

  const proxiedRequest = new Request(`${baBaseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: proxiedHeaders,
  });

  const res = await auth.handler(proxiedRequest);
  if (!res.ok) {
    const body = await res
      .clone()
      .text()
      .catch(() => "(unreadable)");
    console.error(`[sign-out proxy] Better Auth returned ${res.status}:`, body);
  }
  return res;
});

// RBAC 路由
app.post(
  "/api/role-requests",
  async ({ body, request, set }) => {
    const input = createRoleRequestBodySchema.parse(body);
    const user = await requireUser(request, store);
    const roleRequest = await store.createRoleRequest({
      user,
      requestedRole: input.requestedRole,
      reason: input.reason,
    });
    set.status = 201;
    return { data: roleRequest };
  },
  {
    body: createRoleRequestBodySchema,
    detail: {
      tags: ["auth"],
      summary: "Create role request",
      description: "Request an internal staff, chef, or owner role.",
    },
    response: {
      201: roleRequestResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/role-requests",
  async ({ request }) => {
    await requireAnyRole(request, store, ["owner", "admin"]);
    return { data: [...store.getRoleRequests()] };
  },
  {
    detail: {
      tags: ["auth"],
      summary: "List role requests",
      description: "Return role requests for owner/admin review.",
    },
    response: {
      200: roleRequestListResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/role-requests/:id",
  async ({ params, request, set }) => {
    await requireAnyRole(request, store, ["owner", "admin"]);
    const roleRequest = store.getRoleRequestById(parseInt(params.id, 10));
    if (!roleRequest) {
      set.status = 404;
      return { error: "Role request not found" };
    }

    return { data: roleRequest };
  },
  {
    params: roleRequestParamsSchema,
    detail: {
      tags: ["auth"],
      summary: "Get role request",
      description: "Return one role request for owner/admin review.",
    },
    response: {
      200: roleRequestResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/role-requests/:id",
  async ({ params, body, request, set }) => {
    const input = reviewRoleRequestBodySchema.parse(body);
    const reviewer = await requireAnyRole(request, store, ["owner", "admin"]);
    const roleRequest = await store.reviewRoleRequest(parseInt(params.id, 10), {
      action: input.action,
      reviewer,
    });

    if (!roleRequest) {
      set.status = 404;
      return { error: "Role request not found" };
    }

    return { data: roleRequest };
  },
  {
    params: roleRequestParamsSchema,
    body: reviewRoleRequestBodySchema,
    detail: {
      tags: ["auth"],
      summary: "Review role request",
      description: "Approve or reject an internal role request.",
    },
    response: {
      200: roleRequestResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/users/:id/roles",
  async ({ params, body, request }) => {
    const input = updateUserRolesBodySchema.parse(body);
    await requireAnyRole(request, store, ["admin"]);
    const roles = await store.setUserRoles(params.id, input.roles);
    return {
      data: {
        userId: params.id,
        roles,
      },
    };
  },
  {
    params: updateUserRolesParamsSchema,
    body: updateUserRolesBodySchema,
    detail: {
      tags: ["auth"],
      summary: "Update user roles",
      description: "Directly replace a user's RBAC roles. Admin only.",
    },
    response: {
      200: userRolesResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
    },
  },
);

// 菜單路由
app.get("/api/menu", () => ({ data: [...store.getMenu()] }), {
  detail: {
    tags: ["menu"],
    summary: "List menu items",
    description: "Return all available breakfast menu items.",
  },
  response: {
    200: menuListResponseSchema,
  },
});

app.post(
  "/api/menu",
  async ({ body, request, set }) => {
    const input = createMenuItemBodySchema.parse(body);
    await requireAnyRole(request, store, ["owner", "admin"]);
    const newMenuItem = await store.createMenuItem(input);
    set.status = 201;
    return { data: newMenuItem };
  },
  {
    body: createMenuItemBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Create a menu item",
      description: "Add a new menu item into the breakfast menu.",
    },
    response: {
      201: menuItemResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/menu/:id",
  async ({ params, body, request, set }) => {
    await requireAnyRole(request, store, ["owner", "admin"]);
    const menuId = parseInt(params.id);
    const menuItem = await store.updateMenuItem(menuId, body);

    if (!menuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    return { data: menuItem };
  },
  {
    params: updateMenuItemParamsSchema,
    body: updateMenuItemBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Update a menu item",
      description: "Update fields of an existing menu item.",
    },
    response: {
      200: menuItemResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.delete(
  "/api/menu/:id",
  async ({ params, request, set }) => {
    await requireAnyRole(request, store, ["owner", "admin"]);
    const menuId = parseInt(params.id);
    const removedMenuItem = await store.deleteMenuItem(menuId);

    if (!removedMenuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    return { data: removedMenuItem };
  },
  {
    params: deleteMenuItemParamsSchema,
    detail: {
      tags: ["menu"],
      summary: "Delete a menu item",
      description: "Remove a menu item by id.",
    },
    response: {
      200: menuItemResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

// 訂單列表路由
app.get(
  "/api/orders",
  async ({ request }) => {
    const user = await requireUser(request, store);
    const orders = hasAnyRole(user, ["staff", "chef", "owner", "admin"])
      ? store.getOrders()
      : store.getOrders().filter((order) => order.userId === user.id);

    return {
      data: orders.map(toOrderResponse),
    };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "List all orders",
      description:
        "Return all orders for internal roles, or submitted orders owned by the customer.",
    },
    response: {
      200: orderListResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// 取得使用者目前進行中的訂單
app.get(
  "/api/orders/current",
  async ({ request }) => {
    const user = await requireUser(request, store);
    const currentOrder = store.getCurrentOrderByUserId(user.id);
    return { data: currentOrder ? toOrderResponse(currentOrder) : null };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Get current order",
      description:
        "Return the current pending order of a user, or null if none exists.",
    },
    response: {
      200: nullableOrderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// 取得使用者歷史訂單
app.get(
  "/api/orders/history",
  async ({ request }) => {
    const user = await requireUser(request, store);
    return {
      data: store.getOrderHistoryByUserId(user.id).map(toOrderResponse),
    };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Get order history",
      description: "Return submitted orders belonging to a user.",
    },
    response: {
      200: orderListResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// 創建新訂單
app.post(
  "/api/orders",
  async ({ request, set }) => {
    const user = await requireUser(request, store);
    const existingOrder = store.getCurrentOrderByUserId(user.id);
    if (existingOrder) {
      return { data: toOrderResponse(existingOrder) };
    }

    const newOrder = await store.createOrder({ userId: user.id });
    set.status = 201;
    return { data: toOrderResponse(newOrder) };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Create or reuse current order",
      description:
        "Create a new pending order, or return the existing pending order for the user.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      201: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// 獲取單筆訂單
app.get(
  "/api/orders/:id",
  async ({ params, request, set }) => {
    const user = await requireUser(request, store);
    const orderId = parseInt(params.id, 10);
    const order = store.getOrderById(orderId);

    if (!order) {
      set.status = 404;
      return { error: "Order not found" };
    }

    if (
      order.userId !== user.id &&
      !hasAnyRole(user, ["staff", "chef", "owner", "admin"])
    ) {
      set.status = 403;
      return { error: "Forbidden" };
    }

    return { data: toOrderResponse(order) };
  },
  {
    params: getOrderByIdParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Get order by id",
      description:
        "Return a single order when it belongs to the requested user.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

// 更新訂單項目
app.patch(
  "/api/orders/:id",
  async ({ params, body, request, set }) => {
    const input = updateOrderBodySchema.parse(body);
    const user = await requireUser(request, store);
    const orderId = parseInt(params.id);
    const result = await store.updateOrderItem(orderId, {
      userId: user.id,
      itemId: input.itemId,
      qty: input.qty,
    });

    if (result.ok) {
      return { data: toOrderResponse(result.order) };
    }

    if ("code" in result && result.code === "ORDER_NOT_FOUND") {
      set.status = 404;
      return { error: "Order not found" };
    }

    if ("code" in result && result.code === "MENU_ITEM_NOT_FOUND") {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    if ("code" in result && result.code === "ORDER_NOT_OWNED") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    if ("code" in result && result.code === "ORDER_NOT_EDITABLE") {
      set.status = 409;
      return { error: "Order is not editable" };
    }

    set.status = 500;
    return { error: "Unexpected store state" };
  },
  {
    params: updateOrderParamsSchema,
    body: updateOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Update order item quantity",
      description: "Set the quantity of a menu item within a pending order.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
      500: apiErrorResponseSchema,
    },
  },
);

// 送出訂單
app.post(
  "/api/orders/:id/submit",
  async ({ params, request, set }) => {
    const user = await requireUser(request, store);
    const orderId = parseInt(params.id, 10);
    const result = await store.submitOrder(orderId, { userId: user.id });

    if (result.ok) {
      return { data: toOrderResponse(result.order) };
    }

    if ("code" in result && result.code === "ORDER_NOT_FOUND") {
      set.status = 404;
      return { error: "Order not found" };
    }

    if ("code" in result && result.code === "ORDER_NOT_OWNED") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    if ("code" in result && result.code === "ORDER_NOT_EDITABLE") {
      set.status = 409;
      return { error: "Order already submitted" };
    }

    if ("code" in result && result.code === "EMPTY_ORDER") {
      set.status = 400;
      return { error: "Empty order cannot be submitted" };
    }

    set.status = 500;
    return { error: "Unexpected store state" };
  },
  {
    params: submitOrderParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Submit order",
      description: "Submit a pending order that belongs to the user.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      400: apiErrorResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
      500: apiErrorResponseSchema,
    },
  },
);

// 更新訂單狀態
app.patch(
  "/api/orders/:id/status",
  async ({ params, body, request, set }) => {
    const input = updateOrderStatusBodySchema.parse(body);
    await requireAnyRole(request, store, ["staff", "chef", "owner", "admin"]);
    const orderId = parseInt(params.id, 10);
    const result = await store.updateOrderStatus(orderId, {
      status: input.status,
    });

    if (result.ok) {
      return { data: toOrderResponse(result.order) };
    }

    if ("code" in result && result.code === "ORDER_NOT_FOUND") {
      set.status = 404;
      return { error: "Order not found" };
    }

    set.status = 500;
    return { error: "Unexpected store state" };
  },
  {
    params: updateOrderStatusParamsSchema,
    body: updateOrderStatusBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Update order status",
      description:
        "Update kitchen/front-counter order status. Internal roles only.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      500: apiErrorResponseSchema,
    },
  },
);

// 健康檢查路由
app.get("/health", () => ({ status: "ok" }), {
  detail: {
    tags: ["system"],
    summary: "Health check",
    description: "Return API health status.",
  },
  response: {
    200: healthResponseSchema,
  },
});

// ─── Manual Static File & SPA Fallback ────────────────────────────────────────
// 完全手動處理靜態檔案和 SPA fallback，避免 staticPlugin 的路由衝突問題
if (hasPublicAssets) {
  app.get("*", async ({ request }) => {
    const pathname = new URL(request.url).pathname;

    // API 路徑返回 404
    if (pathname.startsWith("/api/") || pathname.startsWith("/openapi")) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 嘗試回傳對應的靜態檔案
    const staticFile = Bun.file(`./public${pathname}`);
    if (pathname !== "/" && (await staticFile.exists())) {
      return staticFile;
    }

    // SPA fallback: 回傳 index.html
    return Bun.file("./public/index.html");
  });
}

// 全域錯誤處理
app.onError(({ error, set, code }) => {
  if (error instanceof Response) {
    set.status = error.status;
    return error;
  }

  if (code === "VALIDATION") {
    set.status = 400;
    return {
      error: "Validation failed",
      message: "Please check your request parameters",
    };
  }

  set.status = 500;
  return { error: "Internal server error" };
});

// 啟動服務器
await store.init();

app.listen(port, () => {
  const localIP = getLocalIP();

  console.log(`🍳 早餐店 API 運行中...`);
  console.log(`   Local:   http://localhost:${port}`);
  console.log(`   Network: http://${localIP}:${port}`);
  console.log(`📋 菜單 API: /api/menu`);
  console.log(`📦 訂單 API: /api/orders`);
  console.log(`💚 健康檢查: /health`);
});
