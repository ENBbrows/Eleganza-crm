-- ============================================================
-- Consultations: video call ($200) and in-studio ($250), both 30 min,
-- both bookable on touch-up slots AND during 1st-application windows.
-- category = null means "matches any availability window" for that business.
-- ============================================================

update public.services set category = null
  where business = 'eleganza' and name = 'Consultation';

update public.services
  set name = 'Video Consultation',
      description = '$200, credited toward your procedure cost when you book one'
  where business = 'eleganza' and name = 'Consultation';

insert into public.services (business, name, duration_minutes, price, requires_confirmation, sort_order, description, category)
select * from (values
  ('eleganza', 'In-Studio Consultation', 30, 250, true, 8,
   '$250, credited toward your procedure cost when you book one', null)
) as v(business, name, duration_minutes, price, requires_confirmation, sort_order, description, category)
where not exists (
  select 1 from public.services where services.business = v.business and services.name = v.name
);
