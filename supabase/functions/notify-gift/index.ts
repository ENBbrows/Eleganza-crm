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
// Required secrets (same as send-reminders / notify-payment):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   -- auto-provided
//   RESEND_API_KEY, RESEND_FROM_ELEGANZA
//   BUSINESS_WHATSAPP_NUMBER, WAM_HANDLE
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_ELEGANZA = Deno.env.get("RESEND_FROM_ELEGANZA") || Deno.env.get("RESEND_FROM") || "Eleganza <onboarding@resend.dev>";
const BUSINESS_WHATSAPP_NUMBER = Deno.env.get("BUSINESS_WHATSAPP_NUMBER") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://enbbrows.github.io/Eleganza-crm";
const TZ = "America/Port_of_Spain";

const STUDIO_ADDRESS = "4 First Street East, deLa Marre Avenue, Trincity, Trinidad and Tobago — ground floor, inside A. Rauseo & Associates office.";

const DESIGN_NAMES: Record<string, string> = {
  love: "Because I Love You",
  christmas: "Season's Greetings",
  milestone: "Congratulations",
};

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
function firstName(name: string) {
  return (name || "there").split(" ")[0];
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

type GiftRow = {
  id: string;
  design: string;
  amount: number;
  currency: string;
  buyer_name: string;
  buyer_email: string;
  recipient_name: string;
  recipient_email: string | null;
  personal_message: string | null;
  signed_by: string | null;
  send_at: string;
  sent_at: string | null;
  redemption_code: string;
  referral_voucher_code: string | null;
};

function contactCardBlock() {
  return (
    `Eleganza Naturally Beautiful\n` +
    `Location: ${STUDIO_ADDRESS}\n` +
    (BUSINESS_WHATSAPP_NUMBER ? `WhatsApp: https://wa.me/${BUSINESS_WHATSAPP_NUMBER}\n` : "") +
    `Website: ${SITE_URL}/home.html`
  );
}

async function deliverToRecipient(g: GiftRow) {
  if (!g.recipient_email) return;
  const name = firstName(g.recipient_name);
  const buyerFirst = firstName(g.buyer_name);
  const bookLink = `${SITE_URL}/book-eleganza.html?gift=${g.redemption_code}`;
  const messageBlock = g.personal_message ? `\n"${g.personal_message}"\n— ${g.signed_by || buyerFirst}\n` : `\n— ${g.signed_by || buyerFirst}\n`;

  const referralLine = g.referral_voucher_code
    ? `\n\nAs a little extra, here's a code to share with a friend for 10% off their first visit (expires in 24 hours): ${g.referral_voucher_code}`
    : "";

  await sendEmail(
    g.recipient_email,
    `You've received an Eleganza gift certificate! 🤍`,
    `Hi ${name},\n\n${buyerFirst} sent you a ${DESIGN_NAMES[g.design] || g.design} gift certificate worth ${fmtMoney(g.amount)} at Eleganza Naturally Beautiful.\n${messageBlock}\n` +
      `Ready to book? Use this link — your gift is already linked to it:\n${bookLink}\n\n` +
      `Before you come in, take a look at the prep info and studio location on the booking page.\n\n` +
      `${contactCardBlock()}${referralLine}\n\nWhat once was, is not all lost.\nEleganza`
  );
}

async function sendBuyerReceipt(g: GiftRow) {
  if (!g.buyer_email) return;
  const name = firstName(g.buyer_name);
  await sendEmail(
    g.buyer_email,
    "Your Eleganza gift certificate receipt",
    `Hi ${name},\n\nThis confirms your ${fmtMoney(g.amount)} ${DESIGN_NAMES[g.design] || g.design} gift certificate for ${g.recipient_name}.\n\n` +
      (g.sent_at || !g.send_at || new Date(g.send_at) <= new Date()
        ? `It's on its way to them now.`
        : `It'll be delivered on ${new Date(g.send_at).toLocaleString("en-US", { timeZone: TZ, dateStyle: "long", timeStyle: "short" })}.`) +
      `\n\nThank you for the gift,\nEleganza`
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
