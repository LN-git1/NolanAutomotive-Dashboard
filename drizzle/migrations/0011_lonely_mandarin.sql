-- Turn per-bill paid flags into real payment entries, then retire the flag.
--
-- A supplier used to be a list of separate bills, each with its own paid/unpaid
-- switch. It is now one running account: `kind = 'charge'` adds to what is owed,
-- `kind = 'payment'` takes off it, and the balance is the difference. That is
-- how the garage actually settles with a supplier — a lump sum off the account,
-- rarely one payment per docket.
--
-- This step is the one that must not be skipped. `kind` defaults to 'charge'
-- (migration 0010), so every historic row is now a charge — including the ones
-- that were already settled. Dropping `paid_at` without first writing the money
-- that came off would silently resurrect every paid bill as outstanding and
-- inflate what the dashboard says is owed to every supplier.
--
-- The old model had no partial payments: a bill was paid or it was not. So the
-- conversion is exact — one payment entry per settled bill, for the full amount,
-- dated when it was marked paid. Nothing is estimated and no balance changes.
--
-- The receipt stays on the charge it was uploaded against; a payment entry
-- deliberately carries no attachment of its own.

INSERT INTO "supplier_bills"
  ("supplier_id", "kind", "amount", "bill_date", "reference", "notes", "created_at")
SELECT
  b."supplier_id",
  'payment',
  b."amount",
  b."paid_at"::date,
  b."reference",
  'Settled under the old per-bill paid flag.',
  b."paid_at"
FROM "supplier_bills" b
WHERE b."paid_at" IS NOT NULL
  -- Only ever converts an original bill. Entries this statement creates are
  -- 'payment' with a NULL paid_at, so they can never be picked up as input.
  AND b."kind" = 'charge';
--> statement-breakpoint

DROP INDEX "supplier_bills_paid_at_idx";--> statement-breakpoint
ALTER TABLE "supplier_bills" DROP COLUMN "paid_at";
