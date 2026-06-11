import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema.ts";

// PostgreSQL namespace 隔離
// 透過 PG_SCHEMA 環境變數切換，預設 "bf_v9"
// V9 使用 bf_v9（Better Auth 整合版本）
// 注意：不能使用 "public" 作為 schema 名稱（Drizzle 限制）
const schemaName = process.env.PG_SCHEMA || "bf_v9";
if (schemaName === "public") {
  throw new Error(
    'PG_SCHEMA cannot be "public". Use a custom schema name or leave it unset to use the default "bf_v9".',
  );
}
const appSchema = pgSchema(schemaName);

// 對照 shared/contracts.ts：
//   MenuItem { id, name, price, category, description, image_url }
//   Order { id, userId: string, total, status, createdAt, submittedAt }
//   OrderItem { item: MenuItem, qty }  → order_items（反正規化）
//
// V9 設計：userId 直接對應 Better Auth 的 user.id（text PK）
// 不再維護獨立的 users 表，身份完全由 Better Auth 管理。

export const menuItemsTable = appSchema.table("menu_items", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
});

export const menuItemVersionsTable = appSchema.table(
  "menu_item_versions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    menuItemId: integer("menu_item_id").notNull(),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    menuItemVersionUniqueIdx: uniqueIndex("menu_item_versions_item_version_idx").on(
      table.menuItemId,
      table.version,
    ),
  }),
);

export const menuSnapshotsTable = appSchema.table(
  "menu_snapshots",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    changedMenuItemId: integer("changed_menu_item_id"),
    items: jsonb("items").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    menuSnapshotVersionUniqueIdx: uniqueIndex(
      "menu_snapshots_version_idx",
    ).on(table.version),
  }),
);

export const userRolesTable = appSchema.table(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (table) => ({
    userRoleUniqueIdx: uniqueIndex("user_roles_user_role_idx").on(
      table.userId,
      table.role,
    ),
  }),
);

export const roleRequestsTable = appSchema.table(
  "role_requests",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    userEmail: text("user_email").notNull(),
    requestedRole: text("requested_role").notNull(),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pendingRoleRequestUniqueIdx: uniqueIndex(
      "role_requests_pending_user_role_idx",
    )
      .on(table.userId, table.requestedRole)
      .where(sql`${table.status} = 'pending'`),
  }),
);

export const ordersTable = appSchema.table("orders", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  createdByUserId: text("created_by_user_id").references(() => user.id),
  createdOnBehalf: boolean("created_on_behalf").notNull().default(false),
  total: integer("total").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const orderItemsTable = appSchema.table(
  "order_items",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id").notNull(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url").notNull(),
    qty: integer("qty").notNull(),
  },
  (table) => ({
    orderItemUniqueIdx: uniqueIndex("order_items_order_item_idx").on(
      table.orderId,
      table.itemId,
    ),
  }),
);
