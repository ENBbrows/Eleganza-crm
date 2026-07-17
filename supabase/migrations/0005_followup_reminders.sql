-- ============================================================
-- Track which completed visits need a "time to book your follow-up"
-- reminder, sent automatically ~3 weeks after the visit (2 weeks'
-- notice before the ideal 5-week follow-up mark).
-- ============================================================

alter table public.receipts add column if not exists needs_followup_reminder boolean not null default false;
alter table public.receipts add column if not exists followup_reminder_sent_at timestamptz;

-- Postgres treats a different parameter list as a new overload rather than
-- a replacement, so drop the old 6-arg signature explicitly.
drop function if exists public.log_receipt(uuid, text, bigint, text, text, numeric);

create or replace function public.log_receipt(
  p_booking_id uuid,
  p_business text,
  p_client_id bigint,
  p_client_name text,
  p_service_name text,
  p_amount numeric,
  p_needs_followup boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into receipts (booking_id, business, client_id, client_name, service_name, amount, needs_followup_reminder)
  values (p_booking_id, p_business, p_client_id, p_client_name, p_service_name, p_amount, p_needs_followup)
  returning id into v_id;

  if p_booking_id is not null then
    update bookings set status = 'completed', updated_at = now()
    where id = p_booking_id and status <> 'completed';
  end if;

  return v_id;
end;
$$;
grant execute on function public.log_receipt(uuid, text, bigint, text, text, numeric, boolean) to anon, authenticated;
