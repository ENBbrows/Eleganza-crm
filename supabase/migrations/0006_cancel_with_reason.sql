-- ============================================================
-- Let clients cancel (with a reason) from the confirm/reschedule link
-- sent in the day-before reminder.
-- ============================================================

alter table public.bookings add column if not exists cancel_reason text;

-- Different parameter count = a new overload, not a replacement, so drop
-- the old single-arg signature explicitly to avoid PostgREST ambiguity.
drop function if exists public.cancel_booking(uuid);

create or replace function public.cancel_booking(p_token uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings
  set status = 'cancelled', cancel_reason = p_reason, updated_at = now()
  where confirm_token = p_token;
  return found;
end;
$$;
grant execute on function public.cancel_booking(uuid, text) to anon, authenticated;
