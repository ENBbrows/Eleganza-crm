-- ============================================================
-- Referral vouchers — after a client pays (WAM! deposit or cash
-- confirmed), they get a shareable 10%-off code for a friend that
-- expires in 24 hours.
-- ============================================================

create table if not exists public.referral_vouchers (
  id uuid primary key default gen_random_uuid(),
  business text not null default 'eleganza' check (business in ('eleganza','enbfocus')),
  code text not null unique,
  discount_pct numeric not null default 10,
  created_by_client_id bigint,
  created_by_name text,
  source_booking_id uuid references public.bookings(id),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_name text,
  created_at timestamptz not null default now()
);

alter table public.referral_vouchers enable row level security;

drop policy if exists "admin full access referral_vouchers" on public.referral_vouchers;
create policy "admin full access referral_vouchers" on public.referral_vouchers for all to authenticated using (true) with check (true);

-- ---- Create a voucher right after a booking is paid/confirmed ----
create or replace function public.create_referral_voucher(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_code text;
  v_expires timestamptz := now() + interval '24 hours';
  v_tries int := 0;
begin
  select id, business, client_id, client_name into b
  from bookings where confirm_token = p_token;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_tries := v_tries + 1;
    exit when not exists (select 1 from referral_vouchers where code = v_code) or v_tries > 5;
  end loop;

  insert into referral_vouchers (business, code, created_by_client_id, created_by_name, source_booking_id, expires_at)
  values (b.business, v_code, b.client_id, b.client_name, b.id, v_expires);

  return jsonb_build_object('ok', true, 'code', v_code, 'discount_pct', 10, 'expires_at', v_expires);
end;
$$;
grant execute on function public.create_referral_voucher(uuid) to anon, authenticated;

-- ---- Redeem a voucher (called from checkin.html for a new client) ----
create or replace function public.redeem_referral_voucher(p_code text, p_redeemed_by_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_discount numeric;
begin
  update referral_vouchers
  set redeemed_at = now(), redeemed_by_name = coalesce(p_redeemed_by_name, redeemed_by_name)
  where code = upper(trim(p_code))
    and redeemed_at is null
    and expires_at > now()
  returning id, discount_pct into v_id, v_discount;

  if v_id is null then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object('valid', true, 'discount_pct', v_discount);
end;
$$;
grant execute on function public.redeem_referral_voucher(text, text) to anon, authenticated;
