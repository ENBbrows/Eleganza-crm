-- ============================================================
-- Log a receipt the moment a WAM! deposit is claimed (not just at
-- checkout), and return everything notify-payment needs to email
-- both the client and Amii immediately.
-- ============================================================

create or replace function public.confirm_payment_intent(p_token uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_deposit numeric := 0;
begin
  select bk.id, bk.business, bk.client_id, bk.client_name, bk.client_phone, bk.client_email,
         bk.start_at, s.name as service_name, s.price, s.currency
  into b
  from bookings bk
  join services s on s.id = bk.service_id
  where bk.confirm_token = p_token;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update bookings set payment_method = p_method, updated_at = now()
  where confirm_token = p_token;

  -- Only a WAM! deposit is real money in hand right now — cash at
  -- check-in gets logged later, same as every other checkout receipt.
  if p_method = 'wam_deposit' and coalesce(b.price, 0) > 0 then
    v_deposit := least(500, b.price);
    insert into receipts (booking_id, business, client_id, client_name, service_name, amount, currency)
    values (b.id, b.business, b.client_id, b.client_name, b.service_name || ' — WAM! Deposit', v_deposit, coalesce(b.currency, 'TTD'));
  end if;

  return jsonb_build_object(
    'ok', true, 'booking_id', b.id, 'business', b.business,
    'client_name', b.client_name, 'client_phone', b.client_phone, 'client_email', b.client_email,
    'service_name', b.service_name, 'start_at', b.start_at,
    'price', b.price, 'currency', b.currency, 'deposit_amount', v_deposit, 'method', p_method
  );
end;
$$;
grant execute on function public.confirm_payment_intent(uuid, text) to anon, authenticated;

-- Superseded by confirm_payment_intent above (same job, plus the receipt log).
drop function if exists public.set_payment_method(uuid, text);
