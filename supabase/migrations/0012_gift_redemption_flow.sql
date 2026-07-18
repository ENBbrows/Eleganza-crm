-- ============================================================
-- Wires up what actually happens when a gift recipient lands on
-- book-eleganza.html?gift=<code>: a read-only lookup so the page can show
-- who it's from and prefill their details, and redemption now also stamps
-- the booking itself so the CRM shows it was paid via gift certificate.
-- ============================================================

-- ---- Read-only lookup — used to show the gift banner and prefill details
--      before the recipient books. Does NOT mark it redeemed. ----
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
  if v.redeemed_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'already_redeemed');
  end if;

  return jsonb_build_object(
    'valid', true, 'design', v.design, 'amount', v.amount, 'currency', v.currency,
    'buyer_name', v.buyer_name, 'recipient_name', v.recipient_name,
    'recipient_email', v.recipient_email, 'recipient_phone', v.recipient_phone
  );
end;
$$;
grant execute on function public.get_gift_certificate(uuid) to anon, authenticated;

-- ---- Redeem at booking time — now also stamps the booking's payment_method
--      so it shows correctly in the CRM's Calendar tab. ----
create or replace function public.redeem_gift_certificate(p_code uuid, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v record;
begin
  select * into v from gift_certificates
  where redemption_code = p_code and payment_status = 'paid' and redeemed_at is null;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  update gift_certificates set redeemed_at = now(), redeemed_booking_id = p_booking_id where id = v.id;
  update bookings set payment_method = 'gift_certificate', updated_at = now() where id = p_booking_id;

  return jsonb_build_object('valid', true, 'amount', v.amount, 'currency', v.currency);
end;
$$;
grant execute on function public.redeem_gift_certificate(uuid, uuid) to anon, authenticated;
