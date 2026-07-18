-- ============================================================
-- Lock down the Clients table (real names/phones/emails/spend history).
--
-- Before this migration, checkin.html and book-eleganza.html fetched the
-- WHOLE Clients table with the public anon key and searched it in the
-- browser to find a phone match. That means anyone who opened dev tools
-- on those public pages — or just replayed the request with the anon key
-- copied out of config.js — could read every client's contact info.
--
-- After this migration: only a logged-in CRM session (authenticated) can
-- SELECT from Clients directly. The public pages switch to
-- lookup_client_by_phone(), a SECURITY DEFINER function that returns only
-- the ONE matching client's safe fields — never the full list. Insert and
-- update stay open to anon, since check-in and booking still need to
-- create/update a client record without a login.
-- ============================================================

alter table public."Clients" enable row level security;

drop policy if exists "admin full access clients" on public."Clients";
drop policy if exists "admin select clients" on public."Clients";
drop policy if exists "admin delete clients" on public."Clients";
drop policy if exists "public insert clients" on public."Clients";
drop policy if exists "public update clients" on public."Clients";

create policy "admin select clients" on public."Clients"
  for select to authenticated using (true);

create policy "admin delete clients" on public."Clients"
  for delete to authenticated using (true);

create policy "public insert clients" on public."Clients"
  for insert to anon, authenticated with check (true);

create policy "public update clients" on public."Clients"
  for update to anon, authenticated using (true) with check (true);

-- ---- Narrow phone lookup for the public pages (returns one client, not the list) ----
create or replace function public.lookup_client_by_phone(p_phone_last7 text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email,
    'visit_count', c.visit_count, 'total_spent', c.total_spent,
    'next_visit_discount', c.next_visit_discount, 'stage', c.stage
  ) into r
  from public."Clients" c
  where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 7) = p_phone_last7
  limit 1;
  return r; -- null if no match
end;
$$;
grant execute on function public.lookup_client_by_phone(text) to anon, authenticated;
