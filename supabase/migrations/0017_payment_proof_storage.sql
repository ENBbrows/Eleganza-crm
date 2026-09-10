-- ============================================================
-- Payment rework: bank transfer + screenshot proof (replacing WAM in the
-- booking flow), day-before payment step on confirm.html, and the data
-- needed for a post-appointment thank-you/receipt link.
-- ============================================================

-- ------------------------------------------------------------
-- Storage: private bucket for payment-proof screenshots.
-- Clients (anon) can upload but never list/read/delete — Amii (logged
-- into the CRM as `authenticated`) can view; service_role (edge
-- functions) bypasses RLS entirely and is used to generate signed URLs
-- for the owner notification email.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

drop policy if exists "payment_proofs_anon_insert" on storage.objects;
create policy "payment_proofs_anon_insert"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'payment-proofs');

drop policy if exists "payment_proofs_authenticated_select" on storage.objects;
create policy "payment_proofs_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-proofs');

-- ------------------------------------------------------------
-- bookings.payment_method already exists (migration 0007); this just
-- adds where the uploaded screenshot lives. Values for payment_method
-- going forward: 'bank_transfer' | 'cash_full' | 'gift_certificate'
-- ('wam_deposit' retired — WAM is no longer offered in the booking flow).
-- ------------------------------------------------------------
alter table public.bookings add column if not exists payment_proof_path text;

create or replace function public.set_payment_proof(p_token uuid, p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings set payment_proof_path = p_path, updated_at = now()
  where confirm_token = p_token;
  return found;
end;
$$;
grant execute on function public.set_payment_proof(uuid, text) to anon, authenticated;

-- Expose payment_method + category so confirm.html knows whether to show
-- the payment step, and thank-you.html knows which follow-up to offer.
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
    'service_name', s.name, 'duration_minutes', s.duration_minutes,
    'price', s.price, 'currency', s.currency,
    'payment_method', b.payment_method, 'category', s.category
  ) into r
  from bookings b join services s on s.id = b.service_id
  where b.confirm_token = p_token;
  return r;
end;
$$;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- Annual Touch-Up now starts tentative (like Microblading/3D Follow-Up
-- already do), since the thank-you flow pre-books it and the client
-- just needs to confirm — "a tentative booking for annual touch up".
-- ------------------------------------------------------------
update public.services set requires_confirmation = true
  where business = 'eleganza' and name = 'Annual Touch-Up';

-- ------------------------------------------------------------
-- confirm_payment_intent (migration 0008) logged an immediate deposit
-- receipt only for 'wam_deposit' — swap that for 'bank_transfer', since
-- WAM is retired and a bank transfer is the same "real money sent now"
-- case cash-at-check-in isn't.
-- ------------------------------------------------------------
create or replace function public.confirm_payment_intent(p_token uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_deposit numeric := 0;
begin
  select bk.id, bk.business, bk.client_id, bk.client_name, bk.client_phone, bk.client_email,
         bk.start_at, s.name as service_name, s.price, s.currency
  into b
  from bookings bk
  join services s on s.id = bk.service_id
  where bk.confirm_token = p_token;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update bookings set payment_method = p_method, updated_at = now()
  where confirm_token = p_token;

  if p_method = 'bank_transfer' and coalesce(b.price, 0) > 0 then
    v_deposit := least(500, b.price);
    insert into receipts (booking_id, business, client_id, client_name, service_name, amount, currency)
    values (b.id, b.business, b.client_id, b.client_name, b.service_name || ' — Bank Transfer Deposit', v_deposit, coalesce(b.currency, 'TTD'));
  end if;

  return jsonb_build_object(
    'ok', true, 'booking_id', b.id, 'business', b.business,
    'client_name', b.client_name, 'client_phone', b.client_phone, 'client_email', b.client_email,
    'service_name', b.service_name, 'start_at', b.start_at,
    'price', b.price, 'currency', b.currency, 'deposit_amount', v_deposit, 'method', p_method
  );
end;
$$;
grant execute on function public.confirm_payment_intent(uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- Receipt lookup for thank-you.html
-- ------------------------------------------------------------
create or replace function public.get_receipt_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'business', b.business, 'client_name', b.client_name,
    'service_name', rc.service_name, 'category', s.category,
    'amount', rc.amount, 'currency', rc.currency, 'receipt_date', rc.created_at
  ) into r
  from bookings b
  join services s on s.id = b.service_id
  join receipts rc on rc.booking_id = b.id
  where b.confirm_token = p_token
  order by rc.created_at desc
  limit 1;
  return r;
end;
$$;
grant execute on function public.get_receipt_by_token(uuid) to anon, authenticated;
