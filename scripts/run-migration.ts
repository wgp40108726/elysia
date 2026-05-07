/**
 * scripts/run-migration.ts
 *
 * 備案 migration 腳本：當 drizzle-kit migrate 因 @neondatabase/serverless
 * WebSocket 問題靜默失敗時，直接讀取 SQL 檔並透過 Pool 執行。
 *
 * 用法：bun scripts/run-migration.ts
 */

import { neonConfig, Pool } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const DATABASE_URL =
  process.env.DATABASE_URL_MIGRATION ?? process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL_MIGRATION or DATABASE_URL is required.");
  process.exit(1);
}

const DRIZZLE_DIR = join(import.meta.dir, "..", "drizzle");
const JOURNAL_PATH = join(DRIZZLE_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const pool = new Pool({ connectionString: DATABASE_URL });

function migrationHash(sqlText: string) {
  return createHash("sha256").update(sqlText).digest("hex");
}

function isAlreadyAppliedError(err: unknown) {
  if (!(err instanceof Error)) {
    return false;
  }

  return (
    err.message.includes("already exists") ||
    err.message.includes("duplicate_table")
  );
}

async function main() {
  const client = await pool.connect();

  try {
    // 建立 drizzle migrations 追蹤 schema（若不存在）
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
        id       serial  PRIMARY KEY,
        hash     text    NOT NULL,
        created_at bigint
      )
    `);

    // 建立應用 schema（若不存在）
    const pgSchema = process.env.PG_SCHEMA ?? "public";
    if (pgSchema !== "public") {
      console.log(`[setup] Creating schema "${pgSchema}" if not exists...`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${pgSchema}"`);
    }

    const journalText = await readFile(JOURNAL_PATH, "utf-8");
    const journal = JSON.parse(journalText) as Journal;

    for (const entry of journal.entries) {
      const sqlPath = join(DRIZZLE_DIR, `${entry.tag}.sql`);

      // 逐步執行每個 statement（以 --> statement-breakpoint 分割）
      const sqlText = await readFile(sqlPath, "utf-8");
      const hash = migrationHash(sqlText);
      const applied = await client.query(
        `select 1 from drizzle."__drizzle_migrations" where hash = $1 limit 1`,
        [hash],
      );

      if (applied.rows.length > 0) {
        console.log(`\n[migration] ${entry.tag} already applied, skipping.`);
        continue;
      }

      const statements = sqlText
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      console.log(
        `\n[migration] ${entry.tag} (${statements.length} statements)`,
      );

      await client.query("BEGIN");

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!;
        console.log(`  [${i + 1}/${statements.length}] executing...`);
        try {
          await client.query(stmt);
        } catch (err: unknown) {
          if (isAlreadyAppliedError(err)) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  [skip] already exists: ${msg.split("\n")[0]}`);
            await client.query("ROLLBACK");
            await client.query("BEGIN");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  [error] ${msg}`);
            await client.query("ROLLBACK");
            throw err;
          }
        }
      }

      await client.query("COMMIT");
      await client.query(
        `insert into drizzle."__drizzle_migrations" (hash, created_at)
         select $1, $2
         where not exists (
           select 1 from drizzle."__drizzle_migrations" where hash = $1
         )`,
        [hash, Date.now()],
      );
      console.log(`  [✓] ${entry.tag} applied`);
    }

    console.log("\n[✓] All migrations applied successfully.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
