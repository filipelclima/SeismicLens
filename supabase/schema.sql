-- SeismicLens — network_snapshots table
-- Run this once in the Supabase SQL editor for a NEW project.
-- For an EXISTING project already running an older version of this schema,
-- run the files in supabase/migrations/ instead (in order) — this file is
-- the fresh-install baseline, not an idempotent migration path.

create table if not exists network_snapshots (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  block_number       bigint not null,
  block_time_avg     numeric not null,
  gas_price          numeric not null,
  rpc_latency        integer not null,
  rpc_latency_p50    integer,
  rpc_latency_p95    integer,
  rpc_latency_p99    integer,
  tx_count           integer not null default 0,
  shielded_tx_count  integer not null default 0, -- type 0x4A (encrypted calldata) only
  src20_transfer_count integer not null default 0, -- SUSDC value-hidden transfers (separate mechanism, never summed with shielded_tx_count)
  chain_id           integer not null,
  health_score       integer,
  anomaly            boolean not null default false,
  anomaly_severity   text
);

create index if not exists network_snapshots_created_at_idx on network_snapshots (created_at desc);
create index if not exists network_snapshots_anomaly_idx on network_snapshots (anomaly) where anomaly = true;

-- Row Level Security: allow public read (dashboard + public-stats API use the
-- anon key directly from the browser), writes only via the service key from
-- /api/collect (which bypasses RLS using the service role).
alter table network_snapshots enable row level security;

create policy "Public read access"
  on network_snapshots for select
  using (true);
