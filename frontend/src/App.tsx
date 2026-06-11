import { useEffect, useState, useMemo } from "react";
import "./App.css";
import type {
  ApiDataResponse,
  CurrentUser,
  InternalRole,
  MenuItem,
  MenuItemVersion,
  Order,
  Role,
  RoleRequest,
} from "../../shared/contracts.ts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function buildApiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

const orderStatusLabel: Record<Order["status"], string> = {
  pending: "待送出",
  submitted: "待確認",
  preparing: "製作中",
  ready: "可取餐",
  completed: "已完成",
  cancelled: "已取消",
};

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [cartQtyByItemId, setCartQtyByItemId] = useState<
    Record<number, number>
  >({});
  const [cartTotal, setCartTotal] = useState(0);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [roleRequestRole, setRoleRequestRole] =
    useState<InternalRole>("staff");
  const [roleRequestReason, setRoleRequestReason] = useState("");
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [assistedCustomerEmail, setAssistedCustomerEmail] = useState("");
  const [menuNameQuery, setMenuNameQuery] = useState("");
  const [assistedItemId, setAssistedItemId] = useState("");
  const [assistedQty, setAssistedQty] = useState("1");
  const [editOrderId, setEditOrderId] = useState("");
  const [editOrderItemId, setEditOrderItemId] = useState("");
  const [editOrderQty, setEditOrderQty] = useState("1");
  const [menuHistory, setMenuHistory] = useState<MenuItemVersion[]>([]);
  const [managementMessage, setManagementMessage] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [targetRoles, setTargetRoles] = useState("customer,staff");
  const [menuDraft, setMenuDraft] = useState({
    id: "",
    name: "",
    price: "",
    category: "餐點",
    description: "",
    image_url: "/imgs/menu/test-v10.webp",
  });

  const canManageRoles = Boolean(user?.roles.includes("admin"));
  const canReviewRequests = Boolean(
    user?.roles.some((role) => role === "owner" || role === "admin"),
  );
  const canManageMenu = canReviewRequests;
  const canManageOrders = Boolean(
    user?.roles.some((role) =>
      ["staff", "chef", "owner", "admin"].includes(role),
    ),
  );
  const canAssistOrders = Boolean(
    user?.roles.some((role) => ["staff", "owner", "admin"].includes(role)),
  );

  async function loadCurrentUser(): Promise<CurrentUser | null> {
    const response = await fetch(buildApiUrl("/api/me"), {
      credentials: "include",
    });

    if (!response.ok) {
      setUser(null);
      return null;
    }

    const payload = (await response.json()) as ApiDataResponse<CurrentUser>;
    setUser(payload.data);
    return payload.data;
  }

  async function loadMenuItems(): Promise<void> {
    const response = await fetch(buildApiUrl("/api/menu"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<MenuItem[]>;
    setItems(Array.isArray(payload?.data) ? payload.data : []);
  }

  function syncCartFromOrder(order: Order) {
    const nextQtyByItemId = order.items.reduce(
      (acc, orderItem) => {
        acc[orderItem.item.id] = orderItem.qty;
        return acc;
      },
      {} as Record<number, number>,
    );

    setCartQtyByItemId(nextQtyByItemId);
    setCartTotal(order.total);
  }

  function resetCartState() {
    setOrderId(null);
    setCartQtyByItemId({});
    setCartTotal(0);
    setIsCartOpen(false);
  }

  async function loadCurrentOrder(): Promise<Order | null> {
    const response = await fetch(buildApiUrl("/api/orders/current"), {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Load current order failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<Order | null>;
    const currentOrder = payload?.data;

    if (!currentOrder) {
      resetCartState();
      return null;
    }

    setOrderId(currentOrder.id);
    syncCartFromOrder(currentOrder);
    return currentOrder;
  }

  async function loadOrderHistory(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) {
      setHistoryLoading(true);
    }

    try {
      const response = await fetch(buildApiUrl("/api/orders/history"), {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Load history failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<Order[]>;
      setHistoryOrders(Array.isArray(payload?.data) ? payload.data : []);
    } finally {
      if (!options.silent) {
        setHistoryLoading(false);
      }
    }
  }

  async function refreshUserOrders(): Promise<void> {
    await Promise.all([loadCurrentOrder(), loadOrderHistory()]);
  }

  async function loadRoleRequests(): Promise<void> {
    if (!canReviewRequests) {
      setRoleRequests([]);
      return;
    }

    const response = await fetch(buildApiUrl("/api/role-requests"), {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Load role requests failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<RoleRequest[]>;
    setRoleRequests(Array.isArray(payload?.data) ? payload.data : []);
  }

  async function loadAllOrders(): Promise<void> {
    if (!canManageOrders) {
      setAllOrders([]);
      return;
    }

    const response = await fetch(buildApiUrl("/api/orders"), {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Load all orders failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<Order[]>;
    setAllOrders(Array.isArray(payload?.data) ? payload.data : []);
  }

  async function loadMenuItemHistory(menuIdText = menuDraft.id): Promise<void> {
    if (!menuIdText) {
      setMenuHistory([]);
      return;
    }

    const response = await fetch(buildApiUrl(`/api/menu/${menuIdText}/history`), {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Load menu history failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<
      MenuItemVersion[]
    >;
    setMenuHistory(Array.isArray(payload?.data) ? payload.data : []);
  }

  useEffect(() => {
    let mounted = true;

    // V10: 從 /api/me 恢復登入狀態與 RBAC roles。
    async function restoreSession() {
      try {
        const currentUser = await loadCurrentUser();
        if (!mounted || !currentUser) {
          return;
        }
      } catch {
        // session 無法取得，維持未登入狀態
      }
    }
    void restoreSession();

    async function loadMenu() {
      try {
        await loadMenuItems();
      } catch (fetchError) {
        if (mounted) {
          setError("無法取得菜單資料，請稍後再試。");
          console.error(fetchError);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadMenu();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setHistoryOrders([]);
      setRoleRequests([]);
      setAllOrders([]);
      setIsCartOpen(false);
      resetCartState();
      return;
    }

    void Promise.all([
      refreshUserOrders(),
      loadRoleRequests(),
      loadAllOrders(),
    ]).catch((refreshError) => {
      setActionError("載入使用者訂單資料失敗，請稍後再試。");
      console.error(refreshError);
    });
  }, [user?.id, user?.roles.join(",")]);

  useEffect(() => {
    if (!user) return;

    const timer = window.setInterval(() => {
      void Promise.all([
        loadOrderHistory({ silent: true }),
        canManageOrders ? loadAllOrders() : Promise.resolve(),
      ]).catch((refreshError) => {
        console.error("Order auto-refresh failed", refreshError);
      });
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [user?.id, user?.roles.join(","), canManageOrders]);

  const grouped = useMemo(() => {
    const groupedItems = items.reduce(
      (acc, item) => {
        const category = item?.category || "未分類";
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(item);
        return acc;
      },
      {} as Record<string, MenuItem[]>,
    );

    const categories = Object.keys(groupedItems).sort((a, b) =>
      a.localeCompare(b, "zh-Hant"),
    );

    return { groupedItems, categories };
  }, [items]);

  const cartItemCount = useMemo(
    () => Object.values(cartQtyByItemId).reduce((sum, qty) => sum + qty, 0),
    [cartQtyByItemId],
  );

  const menuNameMatches = useMemo(() => {
    const query = menuNameQuery.trim().toLocaleLowerCase("zh-TW");
    if (!query) {
      return [];
    }

    return items
      .filter((item) =>
        item.name.toLocaleLowerCase("zh-TW").includes(query),
      )
      .slice(0, 8);
  }, [items, menuNameQuery]);

  const cartDetails = useMemo(() => {
    const itemById = new Map(items.map((item) => [item.id, item]));

    return Object.entries(cartQtyByItemId)
      .map(([itemIdText, qty]) => {
        const itemId = Number(itemIdText);
        const item = itemById.get(itemId);
        if (!item || qty <= 0) {
          return null;
        }

        return {
          itemId,
          qty,
          item,
          subtotal: item.price * qty,
        };
      })
      .filter((entry) => entry !== null);
  }, [cartQtyByItemId, items]);

  async function ensureOrder(): Promise<number> {
    if (!user) {
      throw new Error("Please login first");
    }

    if (orderId !== null) {
      return orderId;
    }

    const response = await fetch(buildApiUrl("/api/orders"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        setUser(null);
        setAuthError("登入狀態已失效，請重新登入。");
        setActionError("登入狀態已失效，請重新登入。");
        setHistoryOrders([]);
        resetCartState();
        throw new Error(`Auth expired: HTTP ${response.status}`);
      }

      throw new Error(`Create order failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<Order>;
    const createdOrderId = payload?.data?.id;

    if (!createdOrderId) {
      throw new Error("Create order failed: invalid payload");
    }

    setOrderId(createdOrderId);
    return createdOrderId;
  }

  async function handleGoogleSignIn(): Promise<void> {
    setAuthError("");
    setIsGoogleSigningIn(true);
    try {
      // Better Auth 的 social sign-in 入口是 POST。
      // 先向後端取得導向 Google 同意頁的 URL，再切換瀏覽器位置。
      const callbackURL = window.location.origin;
      const response = await fetch(buildApiUrl("/api/auth/sign-in/social"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: "google", callbackURL }),
      });

      if (!response.ok) {
        throw new Error(`Google sign-in failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { url?: string };
      if (!payload?.url) {
        throw new Error("Google sign-in failed: missing redirect URL");
      }

      window.location.href = payload.url;
    } catch {
      setAuthError("Google 登入啟動失敗，請稍後再試。");
      setIsGoogleSigningIn(false);
    }
  }

  async function handleLogout(): Promise<void> {
    // 使用 /api/sign-out（server-side proxy），避免 Better Auth CSRF 驗證
    // 因 BETTER_AUTH_URL 設定錯誤造成的假登出（403 被吃掉）。
    // 若登出失敗，顯示錯誤並中止，確保使用者知道 session 仍存在。
    try {
      const res = await fetch(buildApiUrl("/api/sign-out"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setActionError(
          `登出失敗（HTTP ${res.status}），請重試或手動清除瀏覽器 Cookie。`,
        );
        return;
      }
    } catch {
      setActionError("登出時發生網路錯誤，請重試。");
      return;
    }
    setUser(null);
    setAuthError("");
    setActionError("");
    resetCartState();
  }

  async function submitRoleRequest(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(buildApiUrl("/api/role-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          requestedRole: roleRequestRole,
          reason: roleRequestReason,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (response.status === 409) {
          setActionError(
            payload?.error === "User already has this role"
              ? "你已經擁有這個角色。"
              : "相同角色已有待審申請，請勿重複送出。",
          );
          return;
        }
        throw new Error(`Create role request failed: HTTP ${response.status}`);
      }

      setRoleRequestReason("");
      setManagementMessage("角色申請已送出。");
    } catch (requestError) {
      setActionError("角色申請送出失敗。");
      console.error(requestError);
    }
  }

  async function reviewRoleRequest(
    requestId: number,
    action: "approve" | "reject",
  ): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(
        buildApiUrl(`/api/role-requests/${requestId}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action }),
        },
      );

      if (!response.ok) {
        throw new Error(`Review role request failed: HTTP ${response.status}`);
      }

      await loadRoleRequests();
      setManagementMessage(action === "approve" ? "已核准申請。" : "已拒絕申請。");
    } catch (reviewError) {
      setActionError("角色申請審核失敗。");
      console.error(reviewError);
    }
  }

  async function updateTargetUserRoles(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    const roles = targetRoles
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean) as Role[];

    try {
      const response = await fetch(buildApiUrl(`/api/users/${targetUserId}/roles`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roles }),
      });

      if (!response.ok) {
        throw new Error(`Update user roles failed: HTTP ${response.status}`);
      }

      setManagementMessage("使用者角色已更新。");
      if (targetUserId === user?.id) {
        await loadCurrentUser();
      }
    } catch (roleError) {
      setActionError("更新使用者角色失敗。");
      console.error(roleError);
    }
  }

  async function deleteTargetUserRole(role: Role): Promise<void> {
    if (!targetUserId) return;

    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(
        buildApiUrl(`/api/users/${targetUserId}/roles/${role}`),
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(`Delete user role failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<{
        userId: string;
        roles: Role[];
      }>;
      setTargetRoles(payload.data.roles.join(","));
      setManagementMessage(`${role} 角色已移除。`);
      if (targetUserId === user?.id) {
        await loadCurrentUser();
      }
    } catch (roleError) {
      setActionError("刪除使用者角色失敗。");
      console.error(roleError);
    }
  }

  async function updateOrderStatus(
    targetOrderId: number,
    status: Order["status"],
  ): Promise<void> {
    if (status === "pending") return;
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(
        buildApiUrl(`/api/orders/${targetOrderId}/status`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status }),
        },
      );

      if (!response.ok) {
        throw new Error(`Update order status failed: HTTP ${response.status}`);
      }

      await loadAllOrders();
      setManagementMessage(`訂單 #${targetOrderId} 狀態已更新。`);
    } catch (statusError) {
      setActionError("更新訂單狀態失敗。");
      console.error(statusError);
    }
  }

  async function createOrderOnBehalf(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(buildApiUrl("/api/orders/on-behalf"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerEmail: assistedCustomerEmail.trim().toLowerCase(),
          items: [
            {
              itemId: Number(assistedItemId),
              qty: Number(assistedQty),
            },
          ],
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<Order>;
      await loadAllOrders();
      setAssistedItemId("");
      setAssistedQty("1");
      setManagementMessage(`已代建訂單 #${payload.data.id}。`);
    } catch (createError) {
      setActionError(
        createError instanceof Error &&
          createError.message === "Customer already has a pending order"
          ? "該顧客已有待編輯訂單，請直接協助修改。"
          : "櫃台代建訂單失敗，請確認顧客 Email 與品項 ID。",
      );
      console.error(createError);
    }
  }

  async function updateCustomerOrderItem(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(
        buildApiUrl(`/api/orders/${editOrderId}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            itemId: Number(editOrderItemId),
            qty: Number(editOrderQty),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await loadAllOrders();
      setManagementMessage(`訂單 #${editOrderId} 品項已更新。`);
    } catch (updateError) {
      setActionError("只能修改購物車或待確認訂單，請確認訂單與品項 ID。");
      console.error(updateError);
    }
  }

  async function createMenuItem(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(buildApiUrl("/api/menu"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: menuDraft.name,
          price: Number(menuDraft.price),
          category: menuDraft.category,
          description: menuDraft.description,
          image_url: menuDraft.image_url,
        }),
      });

      if (!response.ok) {
        throw new Error(`Create menu item failed: HTTP ${response.status}`);
      }

      await loadMenuItems();
      setManagementMessage("菜單品項已新增。");
    } catch (menuError) {
      setActionError("新增菜單失敗。");
      console.error(menuError);
    }
  }

  async function updateMenuItem(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(buildApiUrl(`/api/menu/${menuDraft.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: menuDraft.name || undefined,
          price: menuDraft.price ? Number(menuDraft.price) : undefined,
          category: menuDraft.category || undefined,
          description: menuDraft.description || undefined,
          image_url: menuDraft.image_url || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Update menu item failed: HTTP ${response.status}`);
      }

      await loadMenuItems();
      await loadMenuItemHistory(String(menuDraft.id));
      setManagementMessage("菜單品項已更新。");
    } catch (menuError) {
      setActionError("更新菜單失敗。");
      console.error(menuError);
    }
  }

  async function deleteMenuItem(): Promise<void> {
    setActionError("");
    setManagementMessage("");

    try {
      const response = await fetch(buildApiUrl(`/api/menu/${menuDraft.id}`), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Delete menu item failed: HTTP ${response.status}`);
      }

      await loadMenuItems();
      await loadMenuItemHistory(String(menuDraft.id));
      setManagementMessage("菜單品項已刪除。");
    } catch (menuError) {
      setActionError("刪除菜單失敗。");
      console.error(menuError);
    }
  }

  async function addToCart(item: MenuItem): Promise<void> {
    setActionError("");
    setActiveItemId(item.id);

    try {
      if (!user) {
        throw new Error("Please login first");
      }

      const patchOrderItem = async (
        targetOrderId: number,
        qty: number,
      ): Promise<Order> => {
        const response = await fetch(
          buildApiUrl(`/api/orders/${targetOrderId}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              itemId: item.id,
              qty,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Update order failed: HTTP ${response.status}`);
        }

        const payload = (await response.json()) as ApiDataResponse<Order>;
        const updatedOrder = payload?.data;

        if (!updatedOrder) {
          throw new Error("Update order failed: invalid payload");
        }

        return updatedOrder;
      };

      const targetOrderId = await ensureOrder();
      const currentQty = cartQtyByItemId[item.id] ?? 0;
      const nextQty = currentQty + 1;

      try {
        const updatedOrder = await patchOrderItem(targetOrderId, nextQty);
        syncCartFromOrder(updatedOrder);
      } catch (firstTryError) {
        const firstTryMessage =
          firstTryError instanceof Error ? firstTryError.message : "";

        // 換帳號或舊訂單失效時，重新同步目前使用者訂單後再重試一次。
        if (
          firstTryMessage.includes("HTTP 403") ||
          firstTryMessage.includes("HTTP 404")
        ) {
          setOrderId(null);

          const recoveredOrder = await loadCurrentOrder();
          const retryOrderId = recoveredOrder?.id ?? (await ensureOrder());
          const recoveredQty =
            recoveredOrder?.items.find(
              (orderItem) => orderItem.item.id === item.id,
            )?.qty ?? 0;
          const retryQty = recoveredQty + 1;

          const retriedOrder = await patchOrderItem(retryOrderId, retryQty);
          syncCartFromOrder(retriedOrder);
          return;
        }

        throw firstTryError;
      }
    } catch (cartError) {
      if (
        cartError instanceof Error &&
        cartError.message.startsWith("Auth expired:")
      ) {
        return;
      }

      if (user) {
        try {
          const recoveredOrder = await loadCurrentOrder();
          const recoveredQty = recoveredOrder?.items.find(
            (orderItem) => orderItem.item.id === item.id,
          )?.qty;

          if (typeof recoveredQty === "number" && recoveredQty > 0) {
            return;
          }
        } catch (recoveryError) {
          console.error(recoveryError);
        }
      }

      setActionError("加入購物車失敗，請稍後再試。");
      console.error(cartError);
    } finally {
      setActiveItemId(null);
    }
  }

  async function clearCart(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }

    setActionError("");
    setIsClearingCart(true);

    try {
      for (const detail of cartDetails) {
        const response = await fetch(buildApiUrl(`/api/orders/${orderId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            itemId: detail.itemId,
            qty: 0,
          }),
        });

        if (!response.ok) {
          throw new Error(`Clear cart failed: HTTP ${response.status}`);
        }
      }

      setCartQtyByItemId({});
      setCartTotal(0);
    } catch (clearError) {
      setActionError("清空購物車失敗，請稍後再試。");
      console.error(clearError);
    } finally {
      setIsClearingCart(false);
    }
  }

  async function submitOrder(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }

    setActionError("");
    setIsSubmittingOrder(true);

    try {
      const response = await fetch(
        buildApiUrl(`/api/orders/${orderId}/submit`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        },
      );

      if (!response.ok) {
        throw new Error(`Submit order failed: HTTP ${response.status}`);
      }

      resetCartState();
      setIsCartOpen(false);
      await loadOrderHistory();
    } catch (submitError) {
      setActionError("送出訂單失敗，請稍後再試。");
      console.error(submitError);
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  function renderMyOrders() {
    return (
      <section className="mb-8 rounded-lg bg-base-100 border border-base-300 p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold">我的訂單</h2>
            <p className="text-sm opacity-70">
              送出後會先進入待確認，店員仍可協助調整內容。
            </p>
          </div>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => {
              void loadOrderHistory();
            }}
          >
            重新整理
          </button>
        </div>
        {historyLoading ? (
          <div className="alert">
            <span>讀取中...</span>
          </div>
        ) : historyOrders.length === 0 ? (
          <div className="alert alert-info">
            <span>目前尚無已送出的訂單。</span>
          </div>
        ) : (
          <div className="space-y-3">
            {historyOrders.map((order) => (
              <article
                key={order.id}
                className="card bg-base-100 shadow-sm border border-base-300"
              >
                <div className="card-body p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="font-semibold">訂單 #{order.id}</h3>
                    <span className="badge badge-success">
                      {orderStatusLabel[order.status]}
                    </span>
                  </div>
                  <p className="text-sm opacity-70">
                    建立時間：
                    {new Date(order.createdAt).toLocaleString("zh-TW")}
                  </p>
                  <ul className="text-sm list-disc pl-5 space-y-1">
                    {order.items.map((detail) => (
                      <li key={`${order.id}-${detail.item.id}`}>
                        {detail.item.name} x {detail.qty}
                      </li>
                    ))}
                  </ul>
                  <p className="font-bold text-right">總額 ${order.total}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error m-4">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-lg flex-col items-stretch gap-2 md:flex-row md:items-center">
        <div className="flex-1 w-full md:w-auto">
          <a className="btn btn-ghost normal-case text-2xl">
            🌅 聯大資工早餐菜單
          </a>
        </div>
        <div className="flex-none w-full md:w-auto">
          <div className="flex flex-wrap gap-2 items-center md:justify-end">
            <div className="badge badge-outline">
              {user ? `已登入 ${user.name}` : "尚未登入"}
            </div>
            {user
              ? user.roles.map((role) => (
                  <div key={role} className="badge badge-neutral">
                    {role}
                  </div>
                ))
              : null}
            <div className="badge badge-primary">
              {items.length} 個品項・{grouped.categories.length} 類
            </div>
            <div className="badge badge-secondary">
              購物車 {cartItemCount} 件
            </div>
            <div className="badge badge-accent">總計 ${cartTotal}</div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setIsCartOpen(true);
              }}
              disabled={!user}
            >
              購物車明細
            </button>
            {user ? (
              <button
                className="btn btn-sm"
                onClick={() => {
                  void handleLogout();
                }}
              >
                登出
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <main className="container mx-auto p-6">
        {!user ? (
          <section className="max-w-xl mx-auto card bg-base-100 shadow-md mb-8">
            <div className="card-body">
              <h2 className="card-title">使用 Google 帳號登入</h2>
              <p className="text-sm opacity-70">
                點擊下方按鈕，使用您的 Google 帳號登入後即可開始點餐。
              </p>
              {authError ? (
                <div className="alert alert-error">
                  <span>{authError}</span>
                </div>
              ) : null}
              <button
                className="btn btn-primary w-full"
                onClick={() => {
                  void handleGoogleSignIn();
                }}
                disabled={isGoogleSigningIn}
              >
                {isGoogleSigningIn ? "導向 Google 中..." : "使用 Google 登入"}
              </button>
            </div>
          </section>
        ) : null}

        {actionError ? (
          <div className="alert alert-warning mb-4">
            <span>{actionError}</span>
          </div>
        ) : null}

        {managementMessage ? (
          <div className="alert alert-success mb-4">
            <span>{managementMessage}</span>
          </div>
        ) : null}

        {user ? renderMyOrders() : null}

        {user ? (
          <section className="mb-8 rounded-lg bg-base-100 border border-base-300 p-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-xl font-bold">權限管理</h2>
                  <p className="text-sm opacity-70">{user.email}</p>
                </div>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    void Promise.all([
                      loadCurrentUser(),
                      loadRoleRequests(),
                      loadAllOrders(),
                      loadMenuItems(),
                    ]);
                  }}
                >
                  重新整理
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="rounded-lg bg-base-200 p-4">
                  <h3 className="font-semibold mb-3">角色申請</h3>
                  <div className="space-y-3">
                    <select
                      className="select select-bordered w-full"
                      value={roleRequestRole}
                      onChange={(event) => {
                        setRoleRequestRole(event.target.value as InternalRole);
                      }}
                    >
                      <option
                        value="staff"
                        disabled={user.roles.includes("staff")}
                      >
                        staff 櫃台
                      </option>
                      <option
                        value="chef"
                        disabled={user.roles.includes("chef")}
                      >
                        chef 廚師
                      </option>
                      <option
                        value="owner"
                        disabled={user.roles.includes("owner")}
                      >
                        owner 店長
                      </option>
                    </select>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-24"
                      value={roleRequestReason}
                      onChange={(event) => {
                        setRoleRequestReason(event.target.value);
                      }}
                      placeholder="申請原因"
                    />
                    <button
                      className="btn btn-primary w-full"
                      disabled={user.roles.includes(roleRequestRole)}
                      onClick={() => {
                        void submitRoleRequest();
                      }}
                    >
                      送出申請
                    </button>
                  </div>
                </div>

                {canReviewRequests ? (
                  <div className="rounded-lg bg-base-200 p-4">
                    <h3 className="font-semibold mb-3">申請審核</h3>
                    {roleRequests.length === 0 ? (
                      <div className="alert">
                        <span>目前沒有申請。</span>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-80 overflow-auto">
                        {roleRequests.map((request) => (
                          <article
                            key={request.id}
                            className="rounded-lg bg-base-100 p-3 border border-base-300"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold">
                                #{request.id} {request.requestedRole}
                              </p>
                              <span className="badge">{request.status}</span>
                            </div>
                            <p className="text-sm opacity-70 truncate">
                              {request.userEmail}
                            </p>
                            <p className="text-sm mt-2">{request.reason || "-"}</p>
                            <div className="flex gap-2 mt-3">
                              <button
                                className="btn btn-xs btn-success"
                                disabled={request.status !== "pending"}
                                onClick={() => {
                                  void reviewRoleRequest(request.id, "approve");
                                }}
                              >
                                核准
                              </button>
                              <button
                                className="btn btn-xs btn-error btn-outline"
                                disabled={request.status !== "pending"}
                                onClick={() => {
                                  void reviewRoleRequest(request.id, "reject");
                                }}
                              >
                                拒絕
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {canManageRoles ? (
                  <div className="rounded-lg bg-base-200 p-4">
                    <h3 className="font-semibold mb-3">使用者角色</h3>
                    <div className="space-y-3">
                      <input
                        className="input input-bordered w-full"
                        value={targetUserId}
                        onChange={(event) => {
                          setTargetUserId(event.target.value);
                        }}
                        placeholder="user id"
                      />
                      <input
                        className="input input-bordered w-full"
                        value={targetRoles}
                        onChange={(event) => {
                          setTargetRoles(event.target.value);
                        }}
                        placeholder="customer,staff,admin"
                      />
                      <div className="flex flex-wrap gap-2">
                        {targetRoles
                          .split(",")
                          .map((role) => role.trim())
                          .filter(Boolean)
                          .map((role) => (
                            <span key={role} className="badge badge-lg gap-2">
                              {role}
                              <button
                                className="btn btn-ghost btn-xs px-1 min-h-0 h-5"
                                type="button"
                                disabled={!targetUserId}
                                onClick={() => {
                                  void deleteTargetUserRole(role as Role);
                                }}
                              >
                                x
                              </button>
                            </span>
                          ))}
                      </div>
                      <button
                        className="btn btn-primary w-full"
                        disabled={!targetUserId}
                        onClick={() => {
                          void updateTargetUserRoles();
                        }}
                      >
                        更新角色
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {canManageOrders ? (
                <div className="rounded-lg bg-base-200 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="font-semibold">訂單狀態</h3>
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => {
                        void loadAllOrders();
                      }}
                    >
                      更新
                    </button>
                  </div>
                  {canAssistOrders ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
                      <div className="rounded-lg bg-base-100 p-3 border border-base-300 lg:col-span-2">
                        <h4 className="font-semibold mb-2">餐品名稱查詢 ID</h4>
                        <input
                          className="input input-bordered input-sm w-full"
                          value={menuNameQuery}
                          onChange={(event) => {
                            setMenuNameQuery(event.target.value);
                          }}
                          placeholder="輸入餐品名稱，例如：牛肉麵"
                          aria-label="查詢餐品名稱"
                        />
                        {menuNameQuery.trim() ? (
                          menuNameMatches.length > 0 ? (
                            <div className="overflow-x-auto mt-2">
                              <table className="table table-sm">
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>餐品名稱</th>
                                    <th>分類</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {menuNameMatches.map((item) => (
                                    <tr key={item.id}>
                                      <td>{item.id}</td>
                                      <td>{item.name}</td>
                                      <td>{item.category}</td>
                                      <td className="text-right">
                                        <button
                                          className="btn btn-primary btn-xs"
                                          onClick={() => {
                                            setAssistedItemId(String(item.id));
                                          }}
                                        >
                                          帶入代建
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm opacity-70 mt-2">
                              找不到符合名稱的餐品。
                            </p>
                          )
                        ) : null}
                      </div>

                      <div className="rounded-lg bg-base-100 p-3 border border-base-300">
                        <h4 className="font-semibold mb-2">櫃台代建訂單</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            className="input input-bordered input-sm"
                            value={assistedCustomerEmail}
                            onChange={(event) => {
                              setAssistedCustomerEmail(event.target.value);
                            }}
                            placeholder="顧客 Email"
                            type="email"
                          />
                          <input
                            className="input input-bordered input-sm"
                            value={assistedItemId}
                            onChange={(event) => {
                              setAssistedItemId(event.target.value);
                            }}
                            placeholder="品項 id"
                            inputMode="numeric"
                          />
                          <input
                            className="input input-bordered input-sm"
                            value={assistedQty}
                            onChange={(event) => {
                              setAssistedQty(event.target.value);
                            }}
                            placeholder="數量"
                            inputMode="numeric"
                          />
                        </div>
                        <button
                          className="btn btn-primary btn-sm mt-2 w-full"
                          disabled={!assistedCustomerEmail || !assistedItemId}
                          onClick={() => {
                            void createOrderOnBehalf();
                          }}
                        >
                          代替顧客建立
                        </button>
                      </div>

                      <div className="rounded-lg bg-base-100 p-3 border border-base-300">
                        <h4 className="font-semibold mb-2">
                          協助修改購物車／待確認訂單
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            className="input input-bordered input-sm"
                            value={editOrderId}
                            onChange={(event) => {
                              setEditOrderId(event.target.value);
                            }}
                            placeholder="訂單 id"
                            inputMode="numeric"
                          />
                          <input
                            className="input input-bordered input-sm"
                            value={editOrderItemId}
                            onChange={(event) => {
                              setEditOrderItemId(event.target.value);
                            }}
                            placeholder="品項 id"
                            inputMode="numeric"
                          />
                          <input
                            className="input input-bordered input-sm"
                            value={editOrderQty}
                            onChange={(event) => {
                              setEditOrderQty(event.target.value);
                            }}
                            placeholder="數量，0 為移除"
                            inputMode="numeric"
                          />
                        </div>
                        <button
                          className="btn btn-secondary btn-sm mt-2 w-full"
                          disabled={!editOrderId || !editOrderItemId}
                          onClick={() => {
                            void updateCustomerOrderItem();
                          }}
                        >
                          更新顧客訂單
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {allOrders.length === 0 ? (
                    <div className="alert">
                      <span>目前沒有訂單。</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>ID</th>
                            {canAssistOrders ? <th>顧客</th> : null}
                            <th>狀態</th>
                            {canAssistOrders ? <th>金額</th> : null}
                            <th>製作內容</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allOrders.map((order) => (
                            <tr key={order.id}>
                              <td>#{order.id}</td>
                              {canAssistOrders ? (
                                <td>
                                  <div className="text-sm font-medium">
                                    {order.customerName ?? "未知顧客"}
                                  </div>
                                  {order.createdOnBehalf ? (
                                    <span className="badge badge-info badge-xs">
                                      櫃台代建
                                    </span>
                                  ) : null}
                                </td>
                              ) : null}
                              <td>
                                <span className="badge badge-outline">
                                  {orderStatusLabel[order.status]}
                                </span>
                              </td>
                              {canAssistOrders ? <td>${order.total}</td> : null}
                              <td>
                                <ul className="text-xs space-y-1">
                                  {order.items.map((detail) => (
                                    <li key={`${order.id}-${detail.item.id}`}>
                                      {detail.item.name} x {detail.qty}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                              <td>
                                <div className="flex flex-col gap-1">
                                  {canAssistOrders &&
                                  ["pending", "submitted"].includes(
                                    order.status,
                                  ) ? (
                                    <button
                                      className="btn btn-secondary btn-xs"
                                      onClick={() => {
                                        setEditOrderId(String(order.id));
                                        setEditOrderItemId(
                                          String(order.items[0]?.item.id ?? ""),
                                        );
                                        setEditOrderQty(
                                          String(order.items[0]?.qty ?? 1),
                                        );
                                      }}
                                    >
                                      修改品項
                                    </button>
                                  ) : null}
                                  <select
                                    className="select select-bordered select-xs"
                                    value={order.status}
                                    onChange={(event) => {
                                      void updateOrderStatus(
                                        order.id,
                                        event.target.value as Order["status"],
                                      );
                                    }}
                                  >
                                    <option value="pending" disabled>
                                      待送出
                                    </option>
                                    <option value="submitted">待確認</option>
                                    <option value="preparing">製作中</option>
                                    <option value="ready">可取餐</option>
                                    <option value="completed">已完成</option>
                                    <option value="cancelled">已取消</option>
                                  </select>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {canManageMenu ? (
                <div className="rounded-lg bg-base-200 p-4">
                  <h3 className="font-semibold mb-3">菜單管理</h3>
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <input
                      className="input input-bordered"
                      value={menuDraft.id}
                      onChange={(event) => {
                        setMenuDraft((draft) => ({
                          ...draft,
                          id: event.target.value,
                        }));
                      }}
                      placeholder="id"
                    />
                    <input
                      className="input input-bordered md:col-span-2"
                      value={menuDraft.name}
                      onChange={(event) => {
                        setMenuDraft((draft) => ({
                          ...draft,
                          name: event.target.value,
                        }));
                      }}
                      placeholder="名稱"
                    />
                    <input
                      className="input input-bordered"
                      value={menuDraft.price}
                      onChange={(event) => {
                        setMenuDraft((draft) => ({
                          ...draft,
                          price: event.target.value,
                        }));
                      }}
                      placeholder="價格"
                      inputMode="numeric"
                    />
                    <input
                      className="input input-bordered"
                      value={menuDraft.category}
                      onChange={(event) => {
                        setMenuDraft((draft) => ({
                          ...draft,
                          category: event.target.value,
                        }));
                      }}
                      placeholder="分類"
                    />
                    <input
                      className="input input-bordered"
                      value={menuDraft.image_url}
                      onChange={(event) => {
                        setMenuDraft((draft) => ({
                          ...draft,
                          image_url: event.target.value,
                        }));
                      }}
                      placeholder="圖片"
                    />
                    <textarea
                      className="textarea textarea-bordered md:col-span-6"
                      value={menuDraft.description}
                      onChange={(event) => {
                        setMenuDraft((draft) => ({
                          ...draft,
                          description: event.target.value,
                        }));
                      }}
                      placeholder="描述"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={
                        !menuDraft.name ||
                        !menuDraft.price ||
                        !menuDraft.description
                      }
                      onClick={() => {
                        void createMenuItem();
                      }}
                    >
                      新增
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={!menuDraft.id}
                      onClick={() => {
                        void updateMenuItem();
                      }}
                    >
                      更新
                    </button>
                    <button
                      className="btn btn-error btn-outline btn-sm"
                      disabled={!menuDraft.id}
                      onClick={() => {
                        void deleteMenuItem();
                      }}
                    >
                      刪除
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={!menuDraft.id}
                      onClick={() => {
                        void loadMenuItemHistory().catch((historyError) => {
                          setActionError("讀取菜單版本歷史失敗。");
                          console.error(historyError);
                        });
                      }}
                    >
                      版本歷史
                    </button>
                  </div>
                  {menuHistory.length > 0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>版本</th>
                            <th>動作</th>
                            <th>名稱</th>
                            <th>價格</th>
                            <th>時間</th>
                          </tr>
                        </thead>
                        <tbody>
                          {menuHistory.map((version) => (
                            <tr key={version.id}>
                              <td>v{version.version}</td>
                              <td>{version.action}</td>
                              <td>{version.snapshot.name}</td>
                              <td>${version.snapshot.price}</td>
                              <td>
                                {new Date(version.changedAt).toLocaleString(
                                  "zh-TW",
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {items.length === 0 ? (
          <div className="alert alert-info">
            <span>目前沒有菜單資料</span>
          </div>
        ) : (
          grouped.categories.map((category) => (
            <div key={category} className="mb-8">
              <h2 className="text-3xl font-bold mb-4 text-primary border-b-2 border-primary pb-2">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(grouped.groupedItems[category] || []).map((item) => (
                  <div
                    key={item.id}
                    className="card bg-base-100 shadow-md hover:shadow-lg transition-shadow"
                  >
                    <figure className="h-44 overflow-hidden bg-base-300">
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(event) => {
                          const target = event.currentTarget;
                          target.src =
                            "https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&w=800&q=80";
                        }}
                      />
                    </figure>
                    <div className="card-body">
                      <h3 className="card-title text-lg">{item.name}</h3>
                      <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                        {item.description}
                      </p>
                      <div className="card-actions justify-between items-center">
                        <div>
                          <span className="text-xl font-bold text-success">
                            ${item.price}
                          </span>
                          {item.priceDelta ? (
                            <div
                              className={`badge badge-sm mt-1 ${
                                item.priceDelta > 0
                                  ? "badge-warning"
                                  : "badge-info"
                              }`}
                            >
                              {item.priceDelta > 0 ? "漲價" : "降價"} $
                              {Math.abs(item.priceDelta)}
                            </div>
                          ) : null}
                        </div>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            void addToCart(item);
                          }}
                          disabled={activeItemId === item.id}
                        >
                          {activeItemId === item.id
                            ? "加入中..."
                            : `加入購物車${cartQtyByItemId[item.id] ? ` (${cartQtyByItemId[item.id]})` : ""}`}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

      </main>

      {user && isCartOpen ? (
        <>
          <button
            className="fixed inset-0 bg-black/35"
            aria-label="close cart drawer"
            onClick={() => {
              setIsCartOpen(false);
            }}
          />
          <aside className="fixed right-0 top-0 h-full w-full max-w-md bg-base-100 shadow-2xl z-10 flex flex-col">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">購物車明細</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setIsCartOpen(false);
                }}
              >
                關閉
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto">
              {cartDetails.length === 0 ? (
                <div className="alert">
                  <span>購物車目前是空的。</span>
                </div>
              ) : (
                <ul className="space-y-3">
                  {cartDetails.map((detail) => (
                    <li
                      key={detail.itemId}
                      className="p-3 rounded-lg bg-base-200 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold">{detail.item.name}</p>
                        <p className="text-sm opacity-70">
                          單價 ${detail.item.price} x {detail.qty}
                        </p>
                      </div>
                      <p className="font-bold">${detail.subtotal}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4 border-t border-base-300 space-y-3">
              <div className="flex items-center justify-between font-semibold">
                <span>總件數</span>
                <span>{cartItemCount}</span>
              </div>
              <div className="flex items-center justify-between text-lg font-bold">
                <span>總金額</span>
                <span>${cartTotal}</span>
              </div>
              <button
                className="btn btn-error btn-outline w-full"
                onClick={() => {
                  void clearCart();
                }}
                disabled={cartDetails.length === 0 || isClearingCart}
              >
                {isClearingCart ? "清空中..." : "清空購物車"}
              </button>
              <button
                className="btn btn-primary w-full"
                onClick={() => {
                  void submitOrder();
                }}
                disabled={cartDetails.length === 0 || isSubmittingOrder}
              >
                {isSubmittingOrder ? "送出中..." : "送出訂單"}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
