-- ============================================================
-- Let Amii edit a booking's client details and/or service from the CRM
-- (reschedule_booking already handles editing the time; cancel_booking
-- already handles cancelling — this fills the remaining gap).
-- ============================================================

create or replace function public.update_booking_details(
  p_booking_id uuid,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_service_id uuid,
  p_notes text default null
)
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
  select * into v_booking from bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_service from services where id = p_service_id and business = v_booking.business and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_service');
  end if;

  -- Service may have a different duration/buffer than the one this
  -- booking was made with, so the busy window needs recomputing —
  -- same approach as reschedule_booking.
  v_new_end := v_booking.start_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes);

  begin
    update bookings
    set client_name = p_client_name,
        client_phone = p_client_phone,
        client_email = p_client_email,
        service_id = p_service_id,
        end_at = v_new_end,
        notes = coalesce(p_notes, notes),
        updated_at = now()
    where id = p_booking_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.update_booking_details(uuid, text, text, text, uuid, text) to authenticated;
