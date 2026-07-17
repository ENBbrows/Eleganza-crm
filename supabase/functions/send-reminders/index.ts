// ============================================================
// send-reminders — Supabase Edge Function
//
// Run on a schedule (Supabase Cron, every 10-15 min — see
// BOOKING_SETUP.md). For every booking that has crossed the
// "day before" or "hour before" mark, sends an email (Resend)
// and a WhatsApp message (Meta Cloud API), then stamps the
// booking so it is never reminded twice.
//
// Required secrets (set with `supabase secrets set ...`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   -- auto-provided by Supabase
//   RESEND_API_KEY                            -- from resend.com
//   RESEND_FROM_ELEGANZA                      -- e.g. "Eleganza <hello@enbfocus.com>"
//   RESEND_FROM_ENBFOCUS                      -- e.g. "ENBfocus <hello@enbfocus.com>"
//   WHATSAPP_TOKEN                            -- Meta Cloud API access token
//   WHATSAPP_PHONE_NUMBER_ID                  -- Meta Cloud API sending number id
//   WHATSAPP_TEMPLATE_DAY_BEFORE              -- approved template name
//   WHATSAPP_TEMPLATE_HOUR_BEFORE             -- approved template name
//   BUSINESS_WHATSAPP_NUMBER                  -- Amii's own WhatsApp, e.g. "18685551234"
//   SITE_URL                                  -- e.g. "https://enbbrows.github.io/Eleganza-crm"
//
// Until the WhatsApp Cloud API + templates are approved, leave
// WHATSAPP_TOKEN unset — the function will skip WhatsApp sends
// and just log what *would* have gone out, so nothing crashes.
// Manual sending in the meantime happens from the CRM's Calendar tab
// (eleganza-crm-dashboard.html?view=calendar).
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_ELEGANZA = Deno.env.get("RESEND_FROM_ELEGANZA") || Deno.env.get("RESEND_FROM") || "Eleganza <onboarding@resend.dev>";
const RESEND_FROM_ENBFOCUS = Deno.env.get("RESEND_FROM_ENBFOCUS") || Deno.env.get("RESEND_FROM") || "ENBfocus <onboarding@resend.dev>";
function fromFor(business: "eleganza" | "enbfocus") {
  return business === "enbfocus" ? RESEND_FROM_ENBFOCUS : RESEND_FROM_ELEGANZA;
}
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_TEMPLATE_DAY_BEFORE = Deno.env.get("WHATSAPP_TEMPLATE_DAY_BEFORE") || "appointment_day_before";
const WHATSAPP_TEMPLATE_HOUR_BEFORE = Deno.env.get("WHATSAPP_TEMPLATE_HOUR_BEFORE") || "appointment_hour_before";
const WHATSAPP_TEMPLATE_FOLLOWUP = Deno.env.get("WHATSAPP_TEMPLATE_FOLLOWUP") || "book_your_followup";
const BUSINESS_WHATSAPP_NUMBER = Deno.env.get("BUSINESS_WHATSAPP_NUMBER") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://enbbrows.github.io/Eleganza-crm";
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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit",
  });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric",
  });
}
function firstName(name: string) {
  return (name || "there").split(" ")[0];
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

type Booking = {
  id: string;
  business: "eleganza" | "enbfocus";
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  start_at: string;
  end_at: string;
  status: string;
  confirm_token: string;
  services: { name: string } | null;
};

function dayBeforeCopy(b: Booking) {
  const name = firstName(b.client_name);
  const when = `${fmtDate(b.start_at)} at ${fmtTime(b.start_at)}`;
  const link = `${SITE_URL}/confirm.html?token=${b.confirm_token}`;
  if (b.business === "enbfocus") {
    return {
      subject: `Confirm your discovery call — ${fmtDate(b.start_at)}`,
      body:
        `Hi ${name},\n\nJust checking in — you're booked for a 15-minute discovery call on ${when}.\n\n` +
        `Still good for you? Confirm or pick a new time here:\n${link}\n\nTalk soon,\nENBfocus`,
    };
  }
  const tentativeNote = b.status === "tentative"
    ? " This time is being held for you — please confirm or pick a new one so we can lock it in."
    : "";
  const prepNote =
    "\n\nBefore you come in, please avoid: alcohol, caffeine, aspirin/blood thinners, working out, sun bathing, and facials or laser treatments." +
    "\n\nReminder: 15-minute grace period. After 15 min, a $200 late fee applies. After 30 min, you'll need to reschedule.";
  return {
    subject: `Your appointment — ${fmtDate(b.start_at)}`,
    body:
      `Hi ${name},\n\nThis is your reminder for tomorrow's appointment: ${when}.${tentativeNote}\n\n` +
      `Confirm or reschedule here:\n${link}${prepNote}\n\nSee you soon,\nEleganza`,
  };
}

function hourBeforeCopy(b: Booking) {
  const name = firstName(b.client_name);
  const time = fmtTime(b.start_at);
  if (b.business === "enbfocus") {
    return {
      subject: `All set for the call, ${name}!`,
      body: `Hey ${name} — all set for the call! See you at ${time}. 🎯`,
    };
  }
  const waLine = BUSINESS_WHATSAPP_NUMBER
    ? `\n\nOn your way? Message me here: https://wa.me/${BUSINESS_WHATSAPP_NUMBER}`
    : "";
  return {
    subject: `See you soon, ${name}!`,
    body: `Hi ${name}, this is your 1-hour reminder — see you at ${time}!${waLine}`,
  };
}

async function sendEmail(to: string, subject: string, body: string, business: "eleganza" | "enbfocus") {
  if (!RESEND_API_KEY || !to) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromFor(business),
      to: [to],
      subject,
      text: body,
    }),
  });
  if (!res.ok) console.error("Resend error:", await res.text());
  return { ok: res.ok };
}

async function sendWhatsApp(phone: string, templateName: string, params: string[]) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !phone) return { skipped: true };
  const to = intlPhone(phone);
  if (!to) return { skipped: true };
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
          ],
        },
      }),
    }
  );
  if (!res.ok) console.error("WhatsApp error:", await res.text());
  return { ok: res.ok };
}

type Receipt = {
  id: string;
  business: "eleganza" | "enbfocus";
  client_id: number | null;
  client_name: string | null;
  created_at: string;
};

function followupCopy(name: string) {
  const link = `${SITE_URL}/book-eleganza.html?category=touch_up`;
  return {
    subject: "Time to book your follow-up",
    body:
      `Hi ${name},\n\nIt's been a few weeks since your visit — time to lock in your follow-up appointment.\n\n` +
      `Book here:\n${link}\n\nSee you soon,\nEleganza`,
  };
}

async function fetchFollowupDue() {
  const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
  const res = await rest(
    `/rest/v1/receipts?select=id,business,client_id,client_name,created_at` +
      `&needs_followup_reminder=eq.true&followup_reminder_sent_at=is.null&created_at=lte.${cutoff}`
  );
  if (!res.ok) {
    console.error("fetchFollowupDue failed:", await res.text());
    return [];
  }
  return (await res.json()) as Receipt[];
}

async function markFollowupSent(id: string) {
  await rest(`/rest/v1/receipts?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ followup_reminder_sent_at: new Date().toISOString() }),
  });
}

// receipts.client_id has no FK (Clients table wasn't guaranteed to have a
// matching PK type when this was built), so look phone/email up separately
// rather than relying on PostgREST embedding.
async function fetchClientsByIds(ids: number[]) {
  const map: Record<number, { phone: string | null; email: string | null }> = {};
  if (!ids.length) return map;
  const res = await rest(`/rest/v1/Clients?select=id,phone,email&id=in.(${ids.join(",")})`);
  if (!res.ok) {
    console.error("fetchClientsByIds failed:", await res.text());
    return map;
  }
  const rows = (await res.json()) as { id: number; phone: string | null; email: string | null }[];
  for (const r of rows) map[r.id] = { phone: r.phone, email: r.email };
  return map;
}

async function fetchDue(field: "day_before_sent_at" | "hour_before_sent_at", fromMin: number, toMin: number) {
  const now = Date.now();
  const from = new Date(now + fromMin * 60000).toISOString();
  const to = new Date(now + toMin * 60000).toISOString();
  const res = await rest(
    `/rest/v1/bookings?select=id,business,client_name,client_phone,client_email,start_at,end_at,status,confirm_token,services(name)` +
      `&status=in.(tentative,confirmed)&${field}=is.null&start_at=gte.${from}&start_at=lte.${to}`
  );
  if (!res.ok) {
    console.error(`fetchDue(${field}) failed:`, await res.text());
    return [];
  }
  return (await res.json()) as Booking[];
}

async function markSent(id: string, field: "day_before_sent_at" | "hour_before_sent_at") {
  await rest(`/rest/v1/bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ [field]: new Date().toISOString() }),
  });
}

Deno.serve(async () => {
  const results: Record<string, number> = { day_before: 0, hour_before: 0, followup: 0 };

  // Day-before window: 23h–25h out, so a job running every 15 min never double-fires
  const dayBefore = await fetchDue("day_before_sent_at", 23 * 60, 25 * 60);
  for (const b of dayBefore) {
    const copy = dayBeforeCopy(b);
    if (b.client_email) await sendEmail(b.client_email, copy.subject, copy.body, b.business);
    if (b.client_phone) {
      await sendWhatsApp(b.client_phone, WHATSAPP_TEMPLATE_DAY_BEFORE, [
        firstName(b.client_name),
        fmtDate(b.start_at),
        fmtTime(b.start_at),
        `${SITE_URL}/confirm.html?token=${b.confirm_token}`,
      ]);
    }
    await markSent(b.id, "day_before_sent_at");
    results.day_before++;
  }

  // Hour-before window: 50-70 min out
  const hourBefore = await fetchDue("hour_before_sent_at", 50, 70);
  for (const b of hourBefore) {
    const copy = hourBeforeCopy(b);
    if (b.client_email) await sendEmail(b.client_email, copy.subject, copy.body, b.business);
    if (b.client_phone) {
      await sendWhatsApp(b.client_phone, WHATSAPP_TEMPLATE_HOUR_BEFORE, [
        firstName(b.client_name),
        fmtTime(b.start_at),
      ]);
    }
    await markSent(b.id, "hour_before_sent_at");
    results.hour_before++;
  }

  // Follow-up booking reminder: ~3 weeks after a 1st-application visit
  const followupDue = await fetchFollowupDue();
  const clientIds = [...new Set(followupDue.map((r) => r.client_id).filter((x): x is number => x != null))];
  const clientMap = await fetchClientsByIds(clientIds);
  for (const r of followupDue) {
    const client = r.client_id != null ? clientMap[r.client_id] : undefined;
    const name = firstName(r.client_name || "");
    const copy = followupCopy(name);
    if (client?.email) await sendEmail(client.email, copy.subject, copy.body, r.business);
    if (client?.phone) await sendWhatsApp(client.phone, WHATSAPP_TEMPLATE_FOLLOWUP, [name]);
    await markFollowupSent(r.id);
    results.followup++;
  }

  return new Response(JSON.stringify({ ok: true, sent: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
