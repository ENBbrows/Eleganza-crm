-- ============================================================
-- Update Eleganza services to match real pricing/menu.
-- Run this in the Supabase SQL editor, same as the first migration.
-- Safe to re-run.
-- ============================================================

update public.services
  set price = 200,
      description = '$200, credited toward your procedure cost when you book one'
  where business = 'eleganza' and name = 'Consultation';

update public.services
  set name = 'Microblading',
      description = 'Full microblading procedure. Includes 1 aftercare cream.',
      sort_order = 1
  where business = 'eleganza' and name = 'Microblading (Full Set)';

update public.services
  set name = 'Microblading Follow-Up',
      description = 'Follow-up appointment after your microblading procedure',
      sort_order = 3
  where business = 'eleganza' and name = 'Microblading Touch-Up';

update public.services set sort_order = 7 where business = 'eleganza' and name = 'Consultation';

insert into public.services (business, name, duration_minutes, price, requires_confirmation, sort_order, description)
select * from (values
  ('eleganza', '3D (Microblading + Shading)', 150, 2500, false, 2, '3D microblading with shading. Includes 1 aftercare cream.'),
  ('eleganza', '3D Follow-Up', 60, 500, false, 4, 'Follow-up appointment after your 3D procedure'),
  ('eleganza', 'Annual Touch-Up', 90, 1000, false, 5, 'Annual maintenance touch-up'),
  ('eleganza', 'Additional Touch-Up', 75, 650, false, 6, 'Touch-up outside the annual schedule')
) as v(business, name, duration_minutes, price, requires_confirmation, sort_order, description)
where not exists (
  select 1 from public.services where services.business = v.business and services.name = v.name
);
