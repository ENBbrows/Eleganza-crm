// ============================================================
// notify-gift — Supabase Edge Function
//
// Fired immediately after a buyer confirms their WAM! payment on
// gift-eleganza.html. Sends the buyer a receipt right away. If the gift
// is scheduled for right now (no future send_at), it also delivers the
// gift to the recipient immediately — their delivery email includes the
// certificate details, the studio's contact card, pre-care/booking info,
// and the bundled 10%-off referral voucher. If send_at is in the future,
// delivery is left for the scheduled sweep (see send-reminders) to pick
// up once that time arrives, and only the buyer's receipt goes out now.
//
// Delivery also tries a WhatsApp notification alongside the email — but
// WhatsApp's rules require an approved message template before a business
// can message someone who hasn't messaged first, so this stays a silent
// no-op until WHATSAPP_TOKEN + WHATSAPP_TEMPLATE_GIFT_RECEIVED are actually
// set. Once they are, gift delivery starts sending WhatsApp automatically —
// no code changes needed then. Suggested template text (submit for approval):
//   "Hi {{1}}, {{2}} sent you a gift certificate from Eleganza Naturally
//    Beautiful. Open it here: {{3}}"
//
// The gift-delivery email body is shared with send-reminders' scheduled
// sweep via _shared/copy.ts — edit the copy there, not in both files.
//
// Required secrets (same as send-reminders / notify-payment):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   -- auto-provided
//   RESEND_API_KEY, RESEND_FROM_ELEGANZA
//   BUSINESS_WHATSAPP_NUMBER, WAM_HANDLE
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_GIFT_RECEIVED  -- optional, for the concierge WhatsApp send
// ============================================================

import { firstName, giftDeliveryEmail, GIFT_DESIGN_NAMES } from "../_shared/copy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_ELEGANZA = Deno.env.get("RESEND_FROM_ELEGANZA") || Deno.env.get("RESEND_FROM") || "Eleganza <onboarding@resend.dev>";
const BUSINESS_WHATSAPP_NUMBER = Deno.env.get("BUSINESS_WHATSAPP_NUMBER") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://enbbrows.github.io/Eleganza-crm";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_TEMPLATE_GIFT_RECEIVED = Deno.env.get("WHATSAPP_TEMPLATE_GIFT_RECEIVED") || "gift_certificate_received";
const TZ = "America/Port_of_Spain";

const STUDIO_ADDRESS = "4 First Street East, deLa Marre Avenue, Trincity, Trinidad and Tobago — ground floor, inside A. Rauseo & Associates office.";

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

function fmtMoney(n: number) {
  return "TT$" + n.toLocaleString();
}
function digits(s: string) {
  return (s || "").replace(/\D/g, "");
}
function intlPhone(phone: string) {
  const d = digits(phone);
  if (d.length === 7) return "1868" + d;
  if (d.length === 10 && d.startsWith("868")) return "1" + d;
  if (d.length === 11 && d.startsWith("1868")) return d;
  if (d.length >= 10) return d;
  return "";
}

async function sendEmail(to: string, subject: string, body: string) {
  if (!RESEND_API_KEY || !to) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM_ELEGANZA, to: [to], subject, text: body }),
  });
  if (!res.ok) console.error("Resend error:", await res.text());
}

async function sendWhatsApp(phone: string, templateName: string, params: string[]) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !phone) return;
  const to = intlPhone(phone);
  if (!to) return;
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) console.error("WhatsApp error:", await res.text());
}

type GiftRow = {
  id: string;
  design: string;
  amount: number;
  currency: string;
  buyer_name: string;
  buyer_email: string;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  personal_message: string | null;
  signed_by: string | null;
  send_at: string;
  sent_at: string | null;
  redemption_code: string;
  referral_voucher_code: string | null;
};

async function deliverToRecipient(g: GiftRow) {
  const name = firstName(g.recipient_name);
  const buyerFirst = firstName(g.buyer_name);
  const openLink = `${SITE_URL}/view-gift.html?code=${g.redemption_code}`;

  if (g.recipient_email) {
    const { subject, body } = giftDeliveryEmail({
      recipientName: g.recipient_name,
      buyerName: g.buyer_name,
      design: g.design,
      amount: g.amount,
      openLink,
      referralVoucherCode: g.referral_voucher_code,
      studioAddress: STUDIO_ADDRESS,
      businessWhatsappNumber: BUSINESS_WHATSAPP_NUMBER,
      siteUrl: SITE_URL,
    });
    await sendEmail(g.recipient_email, subject, body);
  }

  if (g.recipient_phone) {
    await sendWhatsApp(g.recipient_phone, WHATSAPP_TEMPLATE_GIFT_RECEIVED, [name, buyerFirst, openLink]);
  }
}

async function sendBuyerReceipt(g: GiftRow) {
  if (!g.buyer_email) return;
  const name = firstName(g.buyer_name);
  await sendEmail(
    g.buyer_email,
    "Your Eleganza gift certificate receipt",
    `Hi ${name},\n\nThis confirms your ${fmtMoney(g.amount)} ${GIFT_DESIGN_NAMES[g.design] || g.design} gift certificate for ${g.recipient_name}.\n\n` +
      (g.sent_at || !g.send_at || new Date(g.send_at) <= new Date()
        ? `It's on its way to them now.`
        : `It will be delivered on ${new Date(g.send_at).toLocaleString("en-US", { timeZone: TZ, dateStyle: "long", timeStyle: "short" })}.`) +
      `\n\nThank you,\nEleganza`
  );
}

Deno.serve(async (req) => {
  try {
    const { id } = await req.json();
    if (!id) return new Response(JSON.stringify({ ok: false, error: "missing id" }), { status: 400 });

    const res = await rest(`/rest/v1/gift_certificates?id=eq.${id}&select=*`);
    const rows = (await res.json()) as GiftRow[];
    const g = rows[0];
    if (!g) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 });

    await sendBuyerReceipt(g);

    const due = !g.send_at || new Date(g.send_at) <= new Date();
    if (due && !g.sent_at) {
      await deliverToRecipient(g);
      await rest(`/rest/v1/gift_certificates?id=eq.${g.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ sent_at: new Date().toISOString() }),
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("notify-gift error:", e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
});
