ALTER TABLE "bf_v10"."orders" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders" ADD COLUMN "created_on_behalf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders" ADD CONSTRAINT "orders_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "bf_v10"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
WITH "ranked_pending_requests" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id", "requested_role"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS "request_rank"
  FROM "bf_v10"."role_requests"
  WHERE "status" = 'pending'
)
UPDATE "bf_v10"."role_requests"
SET "status" = 'rejected', "reviewed_at" = now()
WHERE "id" IN (
  SELECT "id"
  FROM "ranked_pending_requests"
  WHERE "request_rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "role_requests_pending_user_role_idx" ON "bf_v10"."role_requests" USING btree ("user_id","requested_role") WHERE "bf_v10"."role_requests"."status" = 'pending';
