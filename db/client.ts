import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
const storeDriver = process.env.STORE_DRIVER;

// Only validate DATABASE_URL if using PostgreSQL
if (storeDriver === "postgres" && !databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for PostgreSQL store. Set DATABASE_URL or switch STORE_DRIVER=json.",
  );
}

// Initialize DB client only if DATABASE_URL is available
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
export const db = pool ? drizzle({ client: pool, schema }) : null;
