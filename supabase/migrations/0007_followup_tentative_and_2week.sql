-- ============================================================
-- Follow-up bookings are now tentative until the client pays/confirms,
-- and get a "2 weeks before" pay-and-confirm reminder in addition to
-- the existing day-before / hour-before ones.
-- ============================================================

update public.services set requires_confirmation = true
  where business = 'eleganza' and name in ('Microblading Follow-Up', '3D Follow-Up');

alter table public.bookings add column if not exists two_week_sent_at timestamptz;
alter table public.bookings add column if not exists payment_method text;

create or replace function public.set_payment_method(p_token uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings set payment_method = p_method, updated_at = now()
  where confirm_token = p_token;
  return found;
end;
$$;
grant execute on function public.set_payment_method(uuid, text) to anon, authenticated;

-- Expose price/currency so confirm.html and the reminder can mention the amount due
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
    'price', s.price, 'currency', s.currency
  ) into r
  from bookings b join services s on s.id = b.service_id
  where b.confirm_token = p_token;
  return r;
end;
$$;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;
