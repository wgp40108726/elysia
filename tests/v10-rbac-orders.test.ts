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
  test("records customer and creator for an on-behalf order", async () => {
    const store = await createTestStore();
    const order = await store.createOrder({
      userId: "0002",
      createdByUserId: "0001",
      createdOnBehalf: true,
      reuseExisting: false,
    });

    expect(order.userId).toBe("0002");
    expect(order.createdByUserId).toBe("0001");
    expect(order.createdOnBehalf).toBe(true);
  });

  test("staff can edit another customer's pending order but not a submitted one", async () => {
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
    const rejected = await store.updateOrderItem(order.id, {
      userId: "0001",
      itemId: 1,
      qty: 3,
      canEditAnyOrder: true,
    });
    expect(rejected).toEqual({ ok: false, code: "ORDER_NOT_EDITABLE" });
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
