-- ============================================================
-- Eleganza / ENBfocus Booking & Calendar System
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE throughout.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ------------------------------------------------------------
-- Services offered per business
-- ------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business text not null check (business in ('eleganza','enbfocus')),
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price numeric,
  currency text not null default 'TTD',
  description text,
  requires_confirmation boolean not null default false, -- true = booking starts as 'tentative'
  buffer_minutes int not null default 0,                -- gap kept free after the appointment
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Weekly recurring working hours
-- ------------------------------------------------------------
create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  business text not null check (business in ('eleganza','enbfocus')),
  day_of_week int not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null check (end_time > start_time),
  active boolean not null default true
);

-- ------------------------------------------------------------
-- One-off exceptions: a day off, or an extra opening
-- ------------------------------------------------------------
create table if not exists public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  business text not null check (business in ('eleganza','enbfocus')),
  block_date date not null,
  start_time time,               -- null with is_closed = whole day off
  end_time time,
  is_closed boolean not null default true, -- true = blocked, false = extra opening
  reason text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Bookings
-- ------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  business text not null check (business in ('eleganza','enbfocus')),
  service_id uuid references public.services(id),
  client_id bigint,                 -- loose link to public."Clients".id (Eleganza only, no FK: PK type may vary)
  client_name text not null,
  client_phone text,
  client_email text,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  status text not null default 'confirmed'
    check (status in ('tentative','confirmed','checked_in','completed','cancelled','no_show')),
  notes text,
  intake jsonb,                     -- ENBfocus discovery-call intake answers
  confirm_token uuid not null default gen_random_uuid(),
  day_before_sent_at timestamptz,
  hour_before_sent_at timestamptz,
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_business_start_idx on public.bookings(business, start_at);
create unique index if not exists bookings_confirm_token_idx on public.bookings(confirm_token);

-- Prevent double-booking at the database level (per business, overlapping time ranges)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_no_overlap
      exclude using gist (business with =, tstzrange(start_at, end_at) with &&)
      where (status <> 'cancelled');
  end if;
end $$;

-- ------------------------------------------------------------
-- Receipts — CRM log of completed / paid appointments
-- ------------------------------------------------------------
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id),
  business text not null,
  client_id bigint,
  client_name text,
  service_name text,
  amount numeric,
  currency text not null default 'TTD',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ENBfocus lead pipeline (mirrors the Eleganza Clients stage board)
-- ------------------------------------------------------------
create table if not exists public.enbfocus_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  business_name text,
  platform text,            -- where their audience lives (IG, TikTok, YouTube, email list...)
  audience_notes text,      -- what their audience is asking for
  revenue_goal text,        -- goals for automated revenue streams
  stage text not null default 'lead'
    check (stage in ('lead','discovery_booked','discovery_done','proposal','client','not_a_fit')),
  fit_notes text,
  booking_id uuid references public.bookings(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- Public (anon) gets NO direct table access — every public action
-- goes through a SECURITY DEFINER function below. The admin
-- dashboards authenticate via Supabase Auth (same pattern as the
-- existing Clients ledger) and get full access to these tables.
-- ============================================================
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.bookings enable row level security;
alter table public.receipts enable row level security;
alter table public.enbfocus_leads enable row level security;

drop policy if exists "admin full access services" on public.services;
create policy "admin full access services" on public.services for all to authenticated using (true) with check (true);

drop policy if exists "admin full access availability_rules" on public.availability_rules;
create policy "admin full access availability_rules" on public.availability_rules for all to authenticated using (true) with check (true);

drop policy if exists "admin full access availability_blocks" on public.availability_blocks;
create policy "admin full access availability_blocks" on public.availability_blocks for all to authenticated using (true) with check (true);

drop policy if exists "admin full access bookings" on public.bookings;
create policy "admin full access bookings" on public.bookings for all to authenticated using (true) with check (true);

drop policy if exists "admin full access receipts" on public.receipts;
create policy "admin full access receipts" on public.receipts for all to authenticated using (true) with check (true);

drop policy if exists "admin full access enbfocus_leads" on public.enbfocus_leads;
create policy "admin full access enbfocus_leads" on public.enbfocus_leads for all to authenticated using (true) with check (true);

-- ============================================================
-- Public RPC functions (used by book-eleganza.html, book-enbfocus.html,
-- confirm.html, checkin.html). Each is SECURITY DEFINER so the anon
-- key can call it without any direct table grants above.
-- ============================================================

-- ---- Read the schedule needed to compute open slots client-side ----
create or replace function public.get_booking_schedule(p_business text, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('day_of_week', day_of_week, 'start_time', start_time, 'end_time', end_time))
      from availability_rules where business = p_business and active = true
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('block_date', block_date, 'start_time', start_time, 'end_time', end_time, 'is_closed', is_closed))
      from availability_blocks where business = p_business and block_date between p_from and p_to
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('start_at', start_at, 'end_at', end_at))
      from bookings
      where business = p_business
        and status in ('tentative','confirmed','checked_in')
        and start_at < (p_to + 1)::timestamptz and end_at > p_from::timestamptz
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'duration_minutes', duration_minutes, 'price', price,
        'currency', currency, 'description', description,
        'requires_confirmation', requires_confirmation, 'buffer_minutes', buffer_minutes
      ) order by sort_order)
      from services where business = p_business and active = true
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
grant execute on function public.get_booking_schedule(text, date, date) to anon, authenticated;

-- ---- Create a booking (called after the client picks a free slot) ----
create or replace function public.create_booking(
  p_business text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_name text,
  p_phone text,
  p_email text,
  p_notes text default null,
  p_intake jsonb default null,
  p_client_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service record;
  v_end_at timestamptz;
  v_status text;
  v_booking_id uuid;
  v_token uuid;
begin
  select * into v_service from services where id = p_service_id and business = p_business and active = true;
  if not found then
    raise exception 'invalid_service';
  end if;

  -- end_at stores the busy window (appointment + buffer) so the overlap
  -- constraint and slot search both respect the buffer automatically.
  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes);
  v_status := case when v_service.requires_confirmation then 'tentative' else 'confirmed' end;

  begin
    insert into bookings (business, service_id, client_id, client_name, client_phone, client_email, start_at, end_at, status, notes, intake)
    values (p_business, p_service_id, p_client_id, p_name, p_phone, p_email, p_start_at,
            v_end_at, v_status, p_notes, p_intake)
    returning id, confirm_token into v_booking_id, v_token;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  if p_business = 'enbfocus' then
    insert into enbfocus_leads (name, phone, email, business_name, platform, audience_notes, revenue_goal, stage, booking_id)
    values (
      p_name, p_phone, p_email,
      p_intake->>'business_name', p_intake->>'platform', p_intake->>'audience_notes', p_intake->>'revenue_goal',
      'discovery_booked', v_booking_id
    );
  end if;

  return jsonb_build_object('booking_id', v_booking_id, 'confirm_token', v_token, 'status', v_status,
                             'start_at', p_start_at, 'end_at', v_end_at);
end;
$$;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, jsonb, bigint) to anon, authenticated;

-- ---- Token-based lookup / confirm / reschedule / cancel (emailed & WhatsApp'd links) ----
create or replace function public.get_booking_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'booking_id', b.id, 'business', b.business, 'status', b.status,
    'start_at', b.start_at, 'end_at', b.end_at, 'client_name', b.client_name,
    'service_name', s.name, 'duration_minutes', s.duration_minutes
  ) into r
  from bookings b join services s on s.id = b.service_id
  where b.confirm_token = p_token;
  return r;
end;
$$;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

create or replace function public.confirm_booking(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings set status = 'confirmed', updated_at = now()
  where confirm_token = p_token and status in ('tentative','confirmed');
  return found;
end;
$$;
grant execute on function public.confirm_booking(uuid) to anon, authenticated;

create or replace function public.reschedule_booking(p_token uuid, p_new_start_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_service record;
  v_new_end timestamptz;
begin
  select * into v_booking from bookings where confirm_token = p_token;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_service from services where id = v_booking.service_id;
  v_new_end := p_new_start_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes);

  begin
    update bookings
    set start_at = p_new_start_at, end_at = v_new_end, status = 'confirmed',
        day_before_sent_at = null, hour_before_sent_at = null, updated_at = now()
    where confirm_token = p_token;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  return jsonb_build_object('start_at', p_new_start_at, 'end_at', v_new_end);
end;
$$;
grant execute on function public.reschedule_booking(uuid, timestamptz) to anon, authenticated;

create or replace function public.cancel_booking(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings set status = 'cancelled', updated_at = now() where confirm_token = p_token;
  return found;
end;
$$;
grant execute on function public.cancel_booking(uuid) to anon, authenticated;

-- ---- Check-in integration: called from checkin.html ----
create or replace function public.checkin_booking_by_phone(p_business text, p_phone_last7 text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  update bookings b set status = 'checked_in', checked_in_at = now(), updated_at = now()
  where b.id = (
    select id from bookings
    where business = p_business
      and right(regexp_replace(coalesce(client_phone,''), '\D', '', 'g'), 7) = p_phone_last7
      and start_at::date = (now() at time zone 'America/Port_of_Spain')::date
      and status in ('confirmed','tentative')
    order by start_at asc
    limit 1
  )
  returning jsonb_build_object('booking_id', b.id, 'service_id', b.service_id, 'start_at', b.start_at) into v;
  return v; -- null if no matching booking today
end;
$$;
grant execute on function public.checkin_booking_by_phone(text, text) to anon, authenticated;

-- ---- Receipt logging: called from checkin.html when a visit is completed ----
create or replace function public.log_receipt(
  p_booking_id uuid,
  p_business text,
  p_client_id bigint,
  p_client_name text,
  p_service_name text,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into receipts (booking_id, business, client_id, client_name, service_name, amount)
  values (p_booking_id, p_business, p_client_id, p_client_name, p_service_name, p_amount)
  returning id into v_id;

  if p_booking_id is not null then
    update bookings set status = 'completed', updated_at = now()
    where id = p_booking_id and status <> 'completed';
  end if;

  return v_id;
end;
$$;
grant execute on function public.log_receipt(uuid, text, bigint, text, text, numeric) to anon, authenticated;

-- ============================================================
-- Starter data — edit freely from the admin calendar afterwards.
-- ============================================================
insert into public.services (business, name, duration_minutes, price, requires_confirmation, sort_order, description)
select * from (values
  ('eleganza', 'Microblading (Full Set)', 150, 2000, false, 1, 'Full microblading service'),
  ('eleganza', 'Microblading Touch-Up', 60, 500, false, 2, 'Touch-up for existing clients'),
  ('eleganza', 'Consultation', 30, 0, true, 3, 'Free consult — held tentatively until confirmed'),
  ('enbfocus', 'Discovery Call', 15, 0, false, 1, 'Get-to-know-you call: your audience, your goals, and whether we''re a fit')
) as v(business, name, duration_minutes, price, requires_confirmation, sort_order, description)
where not exists (select 1 from public.services where services.business = v.business and services.name = v.name);

-- Mon–Sat 9am–5pm for Eleganza, Mon–Fri 10am–4pm for ENBfocus (America/Port_of_Spain, no DST)
insert into public.availability_rules (business, day_of_week, start_time, end_time)
select * from (values
  ('eleganza', 1, '09:00'::time, '17:00'::time),
  ('eleganza', 2, '09:00'::time, '17:00'::time),
  ('eleganza', 3, '09:00'::time, '17:00'::time),
  ('eleganza', 4, '09:00'::time, '17:00'::time),
  ('eleganza', 5, '09:00'::time, '17:00'::time),
  ('eleganza', 6, '09:00'::time, '15:00'::time),
  ('enbfocus', 1, '10:00'::time, '16:00'::time),
  ('enbfocus', 2, '10:00'::time, '16:00'::time),
  ('enbfocus', 3, '10:00'::time, '16:00'::time),
  ('enbfocus', 4, '10:00'::time, '16:00'::time),
  ('enbfocus', 5, '10:00'::time, '16:00'::time)
) as v(business, day_of_week, start_time, end_time)
where not exists (
  select 1 from public.availability_rules r
  where r.business = v.business and r.day_of_week = v.day_of_week
);
