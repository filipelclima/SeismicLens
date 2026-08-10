-- SeismicPulse — network_snapshots table
-- Run this once in the Supabase SQL editor for a new project.

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
  shielded_tx_count  integer not null default 0,
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
