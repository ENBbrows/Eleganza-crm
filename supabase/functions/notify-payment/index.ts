// ============================================================
// notify-payment — Supabase Edge Function
//
// Fired immediately (not on a schedule) the moment a client taps
// "I've Sent My Deposit via WAM!" or "I'll Pay Cash at Check-In" on
// book-eleganza.html. Emails a receipt to the client and a heads-up
// to Amii right away — no waiting on the 15-min reminder cron. The
// receipt itself is already logged to the CRM by the confirm_payment_intent
// RPC before this runs; this function is purely about the two emails.
//
// Required secrets (set with `supabase secrets set ...`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   -- auto-provided by Supabase
//   RESEND_API_KEY, RESEND_FROM_ELEGANZA      -- same as send-reminders
//   OWNER_EMAIL                               -- Amii's own inbox for these alerts
//   WAM_HANDLE                                -- shown in the owner alert as a reminder
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_ELEGANZA = Deno.env.get("RESEND_FROM_ELEGANZA") || Deno.env.get("RESEND_FROM") || "Eleganza <onboarding@resend.dev>";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") || "";
const WAM_HANDLE = Deno.env.get("WAM_HANDLE") || "";
const TZ = "America/Port_of_Spain";

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}
function fmtMoney(n: number | null, currency: string | null) {
  if (!n) return "";
  return `${currency || "TTD"}$${n.toLocaleString()}`;
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

type BookingRow = {
  business: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  start_at: string;
  services: { name: string; price: number | null; currency: string | null } | null;
};

Deno.serve(async (req) => {
  try {
    const { token, method } = await req.json();
    if (!token || !method) {
      return new Response(JSON.stringify({ ok: false, error: "missing token/method" }), { status: 400 });
    }

    const res = await rest(
      `/rest/v1/bookings?confirm_token=eq.${token}&select=business,client_name,client_phone,client_email,start_at,services(name,price,currency)`
    );
    const rows = (await res.json()) as BookingRow[];
    const b = Array.isArray(rows) ? rows[0] : rows;
    if (!b || b.business !== "eleganza") {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 });
    }

    const name = firstName(b.client_name);
    const when = `${fmtDate(b.start_at)} at ${fmtTime(b.start_at)}`;
    const price = b.services?.price ?? null;
    const currency = b.services?.currency ?? null;
    const serviceName = b.services?.name ?? "Appointment";

    if (method === "wam_deposit") {
      const deposit = price ? Math.min(500, price) : 0;
      const remainder = price ? price - deposit : 0;
      const balanceLine = remainder > 0 ? ` The remaining ${fmtMoney(remainder, currency)} is due in cash at check-in.` : "";

      await sendEmail(
        b.client_email || "",
        "Your Eleganza deposit receipt",
        `Hi ${name},\n\nThis confirms your ${fmtMoney(deposit, currency)} WAM! deposit for ${serviceName} on ${when}.${balanceLine}\n\nSee you then,\nEleganza`
      );
      await sendEmail(
        OWNER_EMAIL,
        `💰 WAM! deposit received — ${name}`,
        `${b.client_name} sent a ${fmtMoney(deposit, currency)} deposit via WAM! for ${serviceName} on ${when}.\n\n` +
          `Phone: ${b.client_phone || "—"}\nEmail: ${b.client_email || "—"}\n\n` +
          `Check WAM! (${WAM_HANDLE || "your handle"}) to confirm it landed, then mark the booking confirmed in the CRM.`
      );
    } else if (method === "cash_full") {
      await sendEmail(
        b.client_email || "",
        "You're booked — Eleganza",
        `Hi ${name},\n\nYou're all set for ${serviceName} on ${when}. Please bring ${fmtMoney(price, currency)} in cash at check-in.\n\nSee you then,\nEleganza`
      );
      await sendEmail(
        OWNER_EMAIL,
        `📅 Booking confirmed (cash) — ${name}`,
        `${b.client_name} booked ${serviceName} on ${when} and will pay ${fmtMoney(price, currency)} in cash at check-in.\n\n` +
          `Phone: ${b.client_phone || "—"}\nEmail: ${b.client_email || "—"}`
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("notify-payment error:", e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
});
