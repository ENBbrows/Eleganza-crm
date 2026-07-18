-- ============================================================
-- Gift certificates — buy one of 3 designs ($2500 full Microblading or
-- $1000 for a returning client's service), send it to someone else,
-- optionally scheduled for a future date, with a personal message and
-- a bundled 10%-off referral voucher for the recipient.
--
-- Payment follows the same WAM! deposit + manual-confirm pattern already
-- trusted everywhere else on this site (no merchant API access yet).
-- Once Amii's WAM! Business account + real Checkout API are wired in,
-- payment_status will flip to 'paid' automatically instead of by tap.
-- ============================================================

create table if not exists public.gift_certificates (
  id uuid primary key default gen_random_uuid(),
  design text not null check (design in ('love','christmas','milestone')),
  amount numeric not null check (amount in (1000, 2500)),
  currency text not null default 'TTD',
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text,
  recipient_name text not null,
  recipient_email text,
  recipient_phone text,
  personal_message text,
  signed_by text,
  send_at timestamptz not null default now(),
  sent_at timestamptz,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  payment_reference text,
  redemption_code uuid not null default gen_random_uuid(),
  redeemed_at timestamptz,
  redeemed_booking_id uuid references public.bookings(id),
  referral_voucher_code text,
  created_at timestamptz not null default now()
);

create unique index if not exists gift_certificates_redemption_code_idx on public.gift_certificates(redemption_code);
create index if not exists gift_certificates_send_due_idx on public.gift_certificates(payment_status, sent_at, send_at);

alter table public.gift_certificates enable row level security;
drop policy if exists "admin full access gift_certificates" on public.gift_certificates;
create policy "admin full access gift_certificates" on public.gift_certificates for all to authenticated using (true) with check (true);

-- ---- Create a pending order (called when the buyer taps Purchase) ----
create or replace function public.create_gift_order(
  p_design text, p_amount numeric, p_buyer_name text, p_buyer_email text, p_buyer_phone text,
  p_recipient_name text, p_recipient_email text, p_recipient_phone text,
  p_personal_message text, p_signed_by text, p_send_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_code uuid;
begin
  insert into gift_certificates (
    design, amount, buyer_name, buyer_email, buyer_phone,
    recipient_name, recipient_email, recipient_phone,
    personal_message, signed_by, send_at
  ) values (
    p_design, p_amount, p_buyer_name, p_buyer_email, p_buyer_phone,
    p_recipient_name, p_recipient_email, p_recipient_phone,
    p_personal_message, p_signed_by, coalesce(p_send_at, now())
  )
  returning id, redemption_code into v_id, v_code;

  return jsonb_build_object('id', v_id, 'redemption_code', v_code);
end;
$$;
grant execute on function public.create_gift_order(text, numeric, text, text, text, text, text, text, text, text, timestamptz) to anon, authenticated;

-- ---- Buyer taps "I've Sent My Payment via WAM!" — self-reported, same trust
--      model as every other WAM! confirmation on this site. Also logs the
--      sale to receipts (financial tracking) and mints the bundled referral
--      voucher for the recipient. ----
create or replace function public.confirm_gift_payment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  v_voucher_code text;
  v_tries int := 0;
begin
  select * into g from gift_certificates where id = p_id;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  loop
    v_voucher_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_tries := v_tries + 1;
    exit when not exists (select 1 from referral_vouchers where code = v_voucher_code) or v_tries > 5;
  end loop;

  insert into referral_vouchers (business, code, created_by_name, expires_at)
  values ('eleganza', v_voucher_code, g.recipient_name, now() + interval '24 hours');

  update gift_certificates
  set payment_status = 'paid', referral_voucher_code = v_voucher_code
  where id = p_id;

  insert into receipts (business, client_name, service_name, amount, currency)
  values ('eleganza', g.buyer_name, 'Gift Certificate — ' || g.design, g.amount, g.currency);

  return jsonb_build_object('ok', true, 'referral_voucher_code', v_voucher_code, 'send_at', g.send_at);
end;
$$;
grant execute on function public.confirm_gift_payment(uuid) to anon, authenticated;

-- ---- Redeem at booking time (applies the gift's value toward a booking) ----
create or replace function public.redeem_gift_certificate(p_code uuid, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v record;
begin
  select * into v from gift_certificates
  where redemption_code = p_code and payment_status = 'paid' and redeemed_at is null;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  update gift_certificates set redeemed_at = now(), redeemed_booking_id = p_booking_id where id = v.id;
  return jsonb_build_object('valid', true, 'amount', v.amount, 'currency', v.currency);
end;
$$;
grant execute on function public.redeem_gift_certificate(uuid, uuid) to anon, authenticated;
