import { z } from "zod";
import type { Order } from "./contracts.ts";
import {
  currentUserSchema,
  menuItemVersionSchema,
  internalRoleSchema,
  menuItemSchema,
  orderSchema,
  orderStatusSchema,
  roleRequestSchema,
  roleSchema,
} from "./contracts.ts";
import toTaipeiDateTime from "../util.ts";

export type { Order };

// ─── API Layer Error Response（API 層錯誤格式定義）────────────────────────

export const apiErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

// ─── API Layer Order Response（Order 的 API 層呈現）──────────────────────

export const orderResponseSchema = orderSchema.extend({
  userId: z.string().min(1).optional(),
  createdAtTaipei: z.string().min(1),
});

export type OrderResponse = z.infer<typeof orderResponseSchema>;

/**
 * 將數據庫/內部 Order 轉換為 API 響應格式
 * 添加台北時區時間戳
 */
export function toOrderResponse(
  order: Order,
  options: { hideCustomerIdentity?: boolean } | number = {},
): OrderResponse {
  const { userId, customerName, createdByUserId, ...safeOrder } = order;
  const hideCustomerIdentity =
    typeof options === "object" && options.hideCustomerIdentity === true;

  return {
    ...(hideCustomerIdentity
      ? safeOrder
      : { ...safeOrder, userId, customerName, createdByUserId }),
    createdAtTaipei: toTaipeiDateTime(order.createdAt),
  };
}

// ─── Request Schemas（按 route 分組）────────────────────────────────────

/** POST /api/menu */
export const createMenuItemBodySchema = z.object({
  name: z.string().min(1),
  price: z.number().int().min(0),
  category: z.string().min(1),
  description: z.string().min(1),
  image_url: z.string().min(1),
});

/** PATCH /api/menu/:id */
export const updateMenuItemParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

export const updateMenuItemBodySchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().int().min(0).optional(),
  category: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  image_url: z.string().min(1).optional(),
});

/** DELETE /api/menu/:id */
export const deleteMenuItemParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

/** GET /api/menu/:id/history */
export const getMenuHistoryParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

/** GET /api/orders/:id */
export const getOrderByIdParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

/** PATCH /api/orders/:id */
export const updateOrderParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

export const updateOrderBodySchema = z.object({
  itemId: z.number().int().min(1),
  qty: z.number().min(0),
});

/** POST /api/orders/on-behalf */
export const createOrderOnBehalfBodySchema = z.object({
  customerId: z.string().min(1),
  items: z
    .array(
      z.object({
        itemId: z.number().int().min(1),
        qty: z.number().int().min(1),
      }),
    )
    .min(1),
});

/** POST /api/orders/:id/submit */
export const submitOrderParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

/** PATCH /api/orders/:id/status */
export const updateOrderStatusParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

export const updateOrderStatusBodySchema = z.object({
  status: orderStatusSchema.exclude(["pending"]),
});

/** POST /api/role-requests */
export const createRoleRequestBodySchema = z.object({
  requestedRole: internalRoleSchema,
  reason: z.string().max(500).optional().default(""),
});

/** GET/PATCH /api/role-requests/:id */
export const roleRequestParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

export const reviewRoleRequestBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
});

/** PATCH /api/users/:id/roles */
export const updateUserRolesParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateUserRolesBodySchema = z.object({
  roles: z.array(roleSchema).min(1),
});

/** DELETE /api/users/:id/roles/:role */
export const deleteUserRoleParamsSchema = z.object({
  id: z.string().min(1),
  role: roleSchema,
});

// ─── Response Schemas（API envelope 層）─────────────────────────────────

export const currentUserResponseSchema = z.object({
  data: currentUserSchema,
});

export const permissionsResponseSchema = z.object({
  data: z.object({
    roles: z.array(roleSchema),
    permissions: z.array(z.string()),
  }),
});

export const menuListResponseSchema = z.object({
  data: z.array(menuItemSchema),
});

export const menuItemResponseSchema = z.object({
  data: menuItemSchema,
});

export const menuItemHistoryResponseSchema = z.object({
  data: z.array(menuItemVersionSchema),
});

export const roleRequestResponseSchema = z.object({
  data: roleRequestSchema,
});

export const roleRequestListResponseSchema = z.object({
  data: z.array(roleRequestSchema),
});

export const userRolesResponseSchema = z.object({
  data: z.object({
    userId: z.string().min(1),
    roles: z.array(roleSchema),
  }),
});

export const orderListResponseSchema = z.object({
  data: z.array(orderResponseSchema),
});

export const orderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema,
});

export const nullableOrderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema.nullable(),
});

export const healthResponseSchema = z.object({
  status: z.string(),
});
