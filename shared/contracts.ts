import { z } from "zod";

// ─── API Business Schemas（Single Source of Truth）──────────────────────────
// 這裡是前後端共用的業務型別定義。
// 型別（TypeScript type）由 Zod schema 自動推導，不需要手動維護兩份。

export const menuItemSchema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1),
  price: z.number().min(0),
  category: z.string().min(1),
  description: z.string(),
  image_url: z.string().min(1),
  previousPrice: z.number().min(0).optional(),
  priceDelta: z.number().optional(),
  version: z.number().int().min(1).optional(),
  lastChangedAt: z.string().min(1).optional(),
});

export const menuItemVersionActionSchema = z.enum([
  "created",
  "updated",
  "deleted",
]);

export const menuItemVersionSchema = z.object({
  id: z.number().int().min(1),
  menuItemId: z.number().int().min(1),
  version: z.number().int().min(1),
  action: menuItemVersionActionSchema,
  snapshot: menuItemSchema.omit({
    previousPrice: true,
    priceDelta: true,
    version: true,
    lastChangedAt: true,
  }),
  changedAt: z.string().min(1),
});

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(3),
  name: z.string().min(1),
  password: z.string().min(1),
  // 預留個資欄位（未來註冊/個資編輯流程會使用）
  birthday: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});

export const sessionUserSchema = userSchema.pick({
  id: true,
  email: true,
  name: true,
});

export const roleSchema = z.enum([
  "customer",
  "staff",
  "chef",
  "owner",
  "admin",
]);

export const internalRoleSchema = z.enum(["staff", "chef", "owner"]);

export const currentUserSchema = sessionUserSchema.extend({
  roles: z.array(roleSchema).min(1),
});

export const roleRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);

export const roleRequestSchema = z.object({
  id: z.number().int().min(1),
  userId: z.string().min(1),
  userName: z.string().min(1),
  userEmail: z.string().min(3),
  requestedRole: internalRoleSchema,
  reason: z.string(),
  status: roleRequestStatusSchema,
  reviewedBy: z.string().min(1).optional(),
  reviewedAt: z.string().min(1).optional(),
  createdAt: z.string().min(1),
});

export const orderItemSchema = z.object({
  item: menuItemSchema,
  qty: z.number().min(0),
});

export const orderStatusSchema = z.enum([
  "pending",
  "submitted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

export const orderSchema = z.object({
  id: z.number().int().min(1),
  userId: z.string().min(1),
  items: z.array(orderItemSchema),
  total: z.number().min(0),
  status: orderStatusSchema,
  createdAt: z.string().min(1),
  submittedAt: z.string().min(1).optional(),
});

// ─── Derived TypeScript Types（自動推導，永不過時）───────────────────────────
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuItemVersionAction = z.infer<typeof menuItemVersionActionSchema>;
export type MenuItemVersion = z.infer<typeof menuItemVersionSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type Role = z.infer<typeof roleSchema>;
export type InternalRole = z.infer<typeof internalRoleSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type RoleRequestStatus = z.infer<typeof roleRequestStatusSchema>;
export type RoleRequest = z.infer<typeof roleRequestSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type Order = z.infer<typeof orderSchema>;

export interface ApiDataResponse<T> {
  data: T;
}
