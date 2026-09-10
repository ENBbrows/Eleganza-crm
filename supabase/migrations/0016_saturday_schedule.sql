-- ============================================================
-- New weekly schedule: full procedures and follow-ups move to
-- Saturday-only. Consultations keep their own weekday availability
-- (kept separate on purpose — see below) so the earlier "book a
-- consultation with as little as 6 hours' notice" change still works;
-- otherwise they'd be squeezed down to Saturday-only along with
-- everything else. Run this once in the Supabase SQL editor (or
-- `supabase db push` if the migration pipeline is wired up).
-- ============================================================

-- Video/In-Studio Consultation currently have category = null, which
-- (per generateSlots' matching rule: r.category == null || r.category
-- === service.category) means they can ONLY use rules that are also
-- category = null. Give them their own explicit category instead, so a
-- dedicated weekday rule can open just for them without a null-category
-- rule also reopening the Saturday-only procedure/touch-up categories.
update public.services set category = 'consultation'
  where business = 'eleganza' and name in ('Video Consultation', 'In-Studio Consultation');

-- Replace the whole Eleganza weekly schedule. ENBfocus rows are a
-- separate business and untouched by this delete.
delete from public.availability_rules where business = 'eleganza';

insert into public.availability_rules (business, day_of_week, start_time, end_time, category) values
  -- Saturday: full microblading & 3D (first-time procedures)
  ('eleganza', 6, '10:00', '12:00', 'first_application'),
  ('eleganza', 6, '13:00', '14:00', 'first_application'),
  ('eleganza', 6, '15:00', '16:00', 'first_application'),
  -- Saturday: follow-up / touch-up appointments
  -- (covers the whole touch_up category: Microblading Follow-Up, 3D
  -- Follow-Up, Annual Touch-Up, and Additional Touch-Up all share this
  -- category today, so all four land in these two windows)
  ('eleganza', 6, '16:30', '17:30', 'touch_up'),
  ('eleganza', 6, '18:00', '19:00', 'touch_up'),
  -- Consultations: kept available through the week, same spread as the
  -- old Tue/Wed/Thu/Fri schedule, so they aren't limited to Saturday
  ('eleganza', 2, '09:30', '11:30', 'consultation'),
  ('eleganza', 2, '12:30', '14:30', 'consultation'),
  ('eleganza', 2, '16:00', '18:00', 'consultation'),
  ('eleganza', 3, '16:00', '18:00', 'consultation'),
  ('eleganza', 4, '16:00', '18:00', 'consultation'),
  ('eleganza', 5, '09:30', '11:30', 'consultation'),
  ('eleganza', 5, '12:30', '18:00', 'consultation');
