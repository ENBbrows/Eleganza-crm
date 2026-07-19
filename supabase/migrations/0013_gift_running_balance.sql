-- ============================================================
-- Gift certificates become a running balance instead of all-or-nothing.
--
-- Previously, redeeming a gift certificate against ANY booking marked the
-- whole thing "redeemed" even if the booking cost less than the gift's
-- value — the leftover was simply lost. Now each redemption only deducts
-- what that booking actually costs; the same gift link/code stays valid
-- (with a smaller remaining_balance) until it's fully spent, so a client
-- can come back and book something else with what's left.
--
-- Also fixes a real bug: get_gift_certificate never returned
-- personal_message or signed_by, so view-gift.html was silently always
-- showing the fallback message instead of what the buyer actually wrote.
-- ============================================================

alter table public.gift_certificates add column if not exists remaining_balance numeric;
update public.gift_certificates set remaining_balance = amount where remaining_balance is null;

create or replace function public.gift_certificates_set_remaining_balance()
returns trigger
language plpgsql
as $$
begin
  if new.remaining_balance is null then
    new.remaining_balance := new.amount;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_gift_certificates_remaining_balance on public.gift_certificates;
create trigger trg_gift_certificates_remaining_balance
before insert on public.gift_certificates
for each row execute function public.gift_certificates_set_remaining_balance();

-- ---- Read-only lookup — amount now reflects what's LEFT to spend, and the
--      buyer's actual personal message/signature are included. ----
create or replace function public.get_gift_certificate(p_code uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v record;
begin
  select * into v from gift_certificates where redemption_code = p_code;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v.payment_status <> 'paid' then
    return jsonb_build_object('valid', false, 'reason', 'unpaid');
  end if;
  if v.remaining_balance <= 0 then
    return jsonb_build_object('valid', false, 'reason', 'fully_redeemed');
  end if;

  return jsonb_build_object(
    'valid', true, 'design', v.design, 'amount', v.remaining_balance, 'currency', v.currency,
    'buyer_name', v.buyer_name, 'recipient_name', v.recipient_name,
    'recipient_email', v.recipient_email, 'recipient_phone', v.recipient_phone,
    'personal_message', v.personal_message, 'signed_by', v.signed_by
  );
end;
$$;
grant execute on function public.get_gift_certificate(uuid) to anon, authenticated;

-- ---- Redeem at booking time — deducts only what this booking costs from
--      the balance; only stamps redeemed_at once the balance hits zero. ----
create or replace function public.redeem_gift_certificate(p_code uuid, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  v_price numeric;
  v_apply numeric;
  v_new_balance numeric;
begin
  select * into g from gift_certificates
  where redemption_code = p_code and payment_status = 'paid' and remaining_balance > 0;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  select s.price into v_price from bookings b join services s on s.id = b.service_id where b.id = p_booking_id;
  v_apply := least(g.remaining_balance, coalesce(v_price, g.remaining_balance));
  v_new_balance := g.remaining_balance - v_apply;

  update gift_certificates
  set remaining_balance = v_new_balance,
      redeemed_at = case when v_new_balance <= 0 then now() else redeemed_at end,
      redeemed_booking_id = coalesce(redeemed_booking_id, p_booking_id)
  where id = g.id;

  update bookings set payment_method = 'gift_certificate', updated_at = now() where id = p_booking_id;

  return jsonb_build_object('valid', true, 'amount_applied', v_apply, 'remaining_balance', v_new_balance, 'currency', g.currency);
end;
$$;
grant execute on function public.redeem_gift_certificate(uuid, uuid) to anon, authenticated;
