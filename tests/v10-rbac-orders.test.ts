import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { toOrderResponse } from "../shared/route-schemas.ts";
import { JsonFileStore } from "../store/json/JsonFileStore.ts";

const testFiles: string[] = [];

async function createTestStore(): Promise<JsonFileStore> {
  const dataFilePath = `./data/v10-test-${crypto.randomUUID()}.json`;
  testFiles.push(dataFilePath);
  const store = new JsonFileStore({ dataFilePath });
  await store.init();
  return store;
}

afterEach(async () => {
  await Promise.all(
    testFiles.splice(0).map((path) => rm(path, { force: true })),
  );
});

describe("V10 RBAC order flows", () => {
  test("finds a customer by email without exposing database access", async () => {
    const store = await createTestStore();

    await expect(store.findUserByEmail("  AMY@EXAMPLE.COM ")).resolves.toEqual({
      id: "0002",
      name: "Amy",
      email: "amy@example.com",
    });
    await expect(
      store.findUserByEmail("missing@example.com"),
    ).resolves.toBeNull();
  });

  test("creates a complete menu release after every menu change", async () => {
    const store = await createTestStore();

    expect(store.getMenuReleases()).toHaveLength(1);
    await store.updateMenuItem(1, { price: 45 });
    await store.deleteMenuItem(2);

    const releases = store.getMenuReleases();
    expect(releases.map((release) => release.version)).toEqual([3, 2, 1]);
    expect(
      store.getMenuRelease(2)?.items.find((item) => item.id === 1)?.price,
    ).toBe(45);
    expect(
      store.getMenuRelease(3)?.items.some((item) => item.id === 2),
    ).toBe(false);
  });

  test("records customer and creator for an on-behalf order", async () => {
    const store = await createTestStore();
    const order = await store.createOrder({
      userId: "0002",
      createdByUserId: "0001",
      createdOnBehalf: true,
      reuseExisting: false,
    });

    expect(order.userId).toBe("0002");
    expect(order.customerName).toBe("Amy");
    expect(order.createdByUserId).toBe("0001");
    expect(order.createdOnBehalf).toBe(true);
  });

  test("staff can edit a submitted order while it is waiting for confirmation", async () => {
    const store = await createTestStore();
    const order = await store.createOrder({
      userId: "0002",
      createdByUserId: "0001",
      createdOnBehalf: true,
      reuseExisting: false,
    });

    const edited = await store.updateOrderItem(order.id, {
      userId: "0001",
      itemId: 1,
      qty: 2,
      canEditAnyOrder: true,
    });
    expect(edited.ok).toBe(true);

    await store.submitOrder(order.id, {
      userId: "0001",
      canSubmitAnyOrder: true,
    });
    const customerEdit = await store.updateOrderItem(order.id, {
      userId: "0002",
      itemId: 1,
      qty: 3,
    });
    expect(customerEdit).toEqual({ ok: false, code: "ORDER_NOT_EDITABLE" });

    const staffEdit = await store.updateOrderItem(order.id, {
      userId: "0001",
      itemId: 1,
      qty: 3,
      canEditAnyOrder: true,
    });
    expect(staffEdit.ok).toBe(true);

    await store.updateOrderStatus(order.id, { status: "preparing" });
    expect(store.getOrderHistoryByUserId("0002")).toHaveLength(1);
    const preparingEdit = await store.updateOrderItem(order.id, {
      userId: "0001",
      itemId: 1,
      qty: 4,
      canEditAnyOrder: true,
    });
    expect(preparingEdit).toEqual({
      ok: false,
      code: "ORDER_NOT_EDITABLE",
    });
  });

  test("chef response hides customer and creator identities", async () => {
    const store = await createTestStore();
    const order = await store.createOrder({
      userId: "0002",
      createdByUserId: "0001",
      createdOnBehalf: true,
      reuseExisting: false,
    });

    const response = toOrderResponse(order, {
      hideCustomerIdentity: true,
    });
    expect(response.userId).toBeUndefined();
    expect(response.customerName).toBeUndefined();
    expect(response.createdByUserId).toBeUndefined();
    expect(response.id).toBe(order.id);
    expect(response.items).toEqual(order.items);
  });

  test("detects duplicate pending role requests", async () => {
    const store = await createTestStore();
    const user = {
      id: "0002",
      email: "amy@example.com",
      name: "Amy",
      roles: ["customer"] as const,
    };

    await store.createRoleRequest({
      user,
      requestedRole: "staff",
      reason: "counter duty",
    });

    expect(store.hasPendingRoleRequest("0002", "staff")).toBe(true);
    expect(store.hasPendingRoleRequest("0002", "chef")).toBe(false);
  });
});
