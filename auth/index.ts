import { DemoAuth } from "./DemoAuth.ts";
import { PgAuth } from "./pg/PgAuth.ts";
import type { Auth } from "./Auth.ts";

interface CreateAuthOptions {
  dataFilePath?: string;
}

export function createAuth(options: CreateAuthOptions = {}): Auth {
  const driver = process.env.STORE_DRIVER;

  if (driver === "postgres") {
    return new PgAuth();
  }

  return new DemoAuth({
    dataFilePath: options.dataFilePath ?? "./data/store.json",
  });
}

export type { Auth } from "./Auth.ts";
