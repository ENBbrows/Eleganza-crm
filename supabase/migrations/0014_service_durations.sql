-- ============================================================
-- Corrects service durations to match how long appointments actually take:
--   Microblading / 3D (Microblading + Shading): 150 min -> 120 min (2 hrs)
--   All touch-up family services:                90 min -> 60 min (1 hr)
--
-- This also fixes a real booking bug: every first-application availability
-- window (Tue/Wed/Thu/Sat) is exactly 120 minutes wide, so at 150 minutes
-- no Microblading/3D slot could ever fit — every date showed "No openings"
-- regardless of the day picked. At 120 minutes, appointments now fit
-- exactly within those windows.
--
-- Also adds a 30-minute grace period between every appointment (buffer_minutes),
-- so back-to-back bookings within the same availability window are no longer
-- scheduled flush against each other.
-- ============================================================

update public.services set duration_minutes = 120
  where business = 'eleganza' and name in ('Microblading', '3D (Microblading + Shading)');

update public.services set duration_minutes = 60
  where business = 'eleganza' and name in ('Microblading Follow-Up', '3D Follow-Up', 'Annual Touch-Up', 'Additional Touch-Up');

update public.services set buffer_minutes = 30
  where business = 'eleganza';
