-- ============================================================
-- Real weekly schedule + service categories.
--
-- Adds a "category" to services (first_application / touch_up) and to
-- availability windows, so a given time slot can be restricted to only
-- the right kind of appointment (e.g. Tuesdays are 1st-application only,
-- Fridays are touch-up only). Run this in the Supabase SQL editor.
-- ============================================================

alter table public.services add column if not exists category text;
alter table public.availability_rules add column if not exists category text;

-- Categorize Eleganza services
update public.services set category = 'first_application'
  where business = 'eleganza' and name in ('Microblading', '3D (Microblading + Shading)', 'Consultation');
update public.services set category = 'touch_up'
  where business = 'eleganza' and name in ('Microblading Follow-Up', '3D Follow-Up', 'Annual Touch-Up', 'Additional Touch-Up');

-- Touch-up family is now uniformly 1.5 hours per your Friday schedule
update public.services set duration_minutes = 90
  where business = 'eleganza' and name in ('Microblading Follow-Up', '3D Follow-Up', 'Additional Touch-Up');

-- Wipe the old generic Mon-Sat hours and replace with your real weekly schedule.
-- Sunday and Monday intentionally get no rows at all = fully closed.
delete from public.availability_rules where business in ('eleganza', 'enbfocus');

insert into public.availability_rules (business, day_of_week, start_time, end_time, category) values
  -- Tuesday: 1st-application only
  ('eleganza', 2, '09:30', '11:30', 'first_application'),
  ('eleganza', 2, '12:30', '14:30', 'first_application'),
  ('eleganza', 2, '16:00', '18:00', 'first_application'),
  -- Wednesday: touch-up OR 1st-application, 4-6pm
  ('eleganza', 3, '16:00', '18:00', 'touch_up'),
  ('eleganza', 3, '16:00', '18:00', 'first_application'),
  -- Thursday: same as Wednesday
  ('eleganza', 4, '16:00', '18:00', 'touch_up'),
  ('eleganza', 4, '16:00', '18:00', 'first_application'),
  -- Friday: touch-up family only, all day minus lunch
  ('eleganza', 5, '09:30', '11:30', 'touch_up'),
  ('eleganza', 5, '12:30', '18:00', 'touch_up'),
  -- Saturday: 1st-application only, same windows as Tuesday
  ('eleganza', 6, '09:30', '11:30', 'first_application'),
  ('eleganza', 6, '12:30', '14:30', 'first_application'),
  ('eleganza', 6, '16:00', '18:00', 'first_application'),
  -- ENBfocus discovery calls: Wed & Thu mornings only
  -- (1-3pm Wed/Thu is your own ENBfocus work time — intentionally no rule, so nothing can book it)
  ('enbfocus', 3, '10:00', '11:30', null),
  ('enbfocus', 4, '10:00', '11:30', null);

-- Updated to also expose "category" to the booking pages
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
      select jsonb_agg(jsonb_build_object('day_of_week', day_of_week, 'start_time', start_time, 'end_time', end_time, 'category', category))
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
        'currency', currency, 'description', description, 'category', category,
        'requires_confirmation', requires_confirmation, 'buffer_minutes', buffer_minutes
      ) order by sort_order)
      from services where business = p_business and active = true
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
grant execute on function public.get_booking_schedule(text, date, date) to anon, authenticated;
