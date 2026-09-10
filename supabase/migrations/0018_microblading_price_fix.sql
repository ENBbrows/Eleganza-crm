-- ============================================================
-- Microblading (first application) is $2000, not $1600. The original
-- seed (migration 0001) set $2000 and no later migration in this repo
-- changed it, so the live price must have drifted from a manual edit
-- outside of migrations — correcting it back here.
-- ============================================================

update public.services set price = 2000
  where business = 'eleganza' and name = 'Microblading';
