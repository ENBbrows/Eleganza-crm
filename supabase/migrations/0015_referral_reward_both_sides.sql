-- ============================================================
-- Referral rewards become two-sided: the friend still gets 10% off
-- their first visit (unchanged), and now the client who shared the
-- code also gets 10% off their OWN next visit once that friend
-- actually uses it — a "give 10%, get 10%" referral instead of a
-- one-sided one.
-- ============================================================

alter table public."Clients" add column if not exists referral_reward_pct numeric;

-- ---- Redeem a voucher — now also credits the referrer's own account ----
create or replace function public.redeem_referral_voucher(p_code text, p_redeemed_by_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_discount numeric;
  v_referrer_id bigint;
begin
  update referral_vouchers
  set redeemed_at = now(), redeemed_by_name = coalesce(p_redeemed_by_name, redeemed_by_name)
  where code = upper(trim(p_code))
    and redeemed_at is null
    and expires_at > now()
  returning id, discount_pct, created_by_client_id into v_id, v_discount, v_referrer_id;

  if v_id is null then
    return jsonb_build_object('valid', false);
  end if;

  if v_referrer_id is not null then
    update public."Clients"
    set referral_reward_pct = greatest(coalesce(referral_reward_pct, 0), v_discount)
    where id = v_referrer_id;
  end if;

  return jsonb_build_object('valid', true, 'discount_pct', v_discount);
end;
$$;
grant execute on function public.redeem_referral_voucher(text, text) to anon, authenticated;

-- ---- lookup_client_by_phone now also returns the pending referral reward ----
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
    'next_visit_discount', c.next_visit_discount, 'referral_reward_pct', c.referral_reward_pct,
    'stage', c.stage
  ) into r
  from public."Clients" c
  where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 7) = p_phone_last7
  limit 1;
  return r; -- null if no match
end;
$$;
grant execute on function public.lookup_client_by_phone(text) to anon, authenticated;
