-- SeismicLens — add src20_transfer_count to network_snapshots
-- Run this once in the Supabase SQL editor for an EXISTING project (one that
-- already ran the original supabase/schema.sql before this column existed).
-- Fresh installs get this column directly from schema.sql and don't need it.
--
-- Additive only: existing rows default to 0, which is honest — the collector
-- never tracked SRC20 activity before this migration, so there's nothing to
-- backfill. SRC20 history starts from whenever this ships, not retroactively.

alter table network_snapshots
  add column if not exists src20_transfer_count integer not null default 0;
