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
const WHATSAPP_TEMPLATE_TWO_WEEK = Deno.env.get("WHATSAPP_TEMPLATE_TWO_WEEK") || "pay_and_confirm_followup";
const BUSINESS_WHATSAPP_NUMBER = Deno.env.get("BUSINESS_WHATSAPP_NUMBER") || "";
const WAM_HANDLE = Deno.env.get("WAM_HANDLE") || "";
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
  services: { name: string; price: number | null; currency: string | null } | null;
};

function fmtMoney(n: number | null, currency: string | null) {
  if (!n) return "";
  return `${currency || "TTD"}$${n.toLocaleString()}`;
}

function twoWeekCopy(b: Booking) {
  const name = firstName(b.client_name);
  const when = `${fmtDate(b.start_at)} at ${fmtTime(b.start_at)}`;
  const link = `${SITE_URL}/confirm.html?token=${b.confirm_token}`;
  const price = b.services?.price ?? null;
  const currency = b.services?.currency ?? null;
  const deposit = price ? Math.min(500, price) : null;
  const instruction = deposit && WAM_HANDLE
    ? `Please send a ${fmtMoney(deposit, currency)} deposit via WAM! to ${WAM_HANDLE} to secure it (balance due in cash at check-in), and confirm here:`
    : "Please confirm here:";
  return {
    subject: "Time to confirm your follow-up",
    body:
      `Hi ${name},\n\nYour follow-up appointment is coming up in 2 weeks: ${when}. ${instruction}\n${link}\n\n` +
      `You can also reschedule or cancel from that same link.\n\nSee you soon,\nEleganza`,
  };
}

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
      `Please confirm, reschedule, or cancel here (you can let us know your reason if you cancel):\n${link}${prepNote}\n\nSee you soon,\nEleganza`,
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
    body: `Hi ${name}, this is your 1-hour reminder — see you at ${time}!\n\nReminder: a $200 late fee applies after 15 minutes, and after 30 minutes you'll need to reschedule.${waLine}`,
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

// Skip the "time to book your follow-up" nudge if they already have one
// pending (e.g. booked tentatively via the button right at checkout) —
// that booking's own 2-week reminder covers it instead.
async function hasUpcomingTouchUp(clientId: number) {
  const now = new Date().toISOString();
  const res = await rest(
    `/rest/v1/bookings?client_id=eq.${clientId}&business=eq.eleganza&status=in.(tentative,confirmed)` +
      `&start_at=gt.${now}&select=id,services!inner(category)&services.category=eq.touch_up&limit=1`
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
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

type SentField = "day_before_sent_at" | "hour_before_sent_at" | "two_week_sent_at";

async function fetchDue(field: SentField, fromMin: number, toMin: number, statuses: string[] = ["tentative", "confirmed"]) {
  const now = Date.now();
  const from = new Date(now + fromMin * 60000).toISOString();
  const to = new Date(now + toMin * 60000).toISOString();
  const res = await rest(
    `/rest/v1/bookings?select=id,business,client_name,client_phone,client_email,start_at,end_at,status,confirm_token,services(name,price,currency)` +
      `&status=in.(${statuses.join(",")})&${field}=is.null&start_at=gte.${from}&start_at=lte.${to}`
  );
  if (!res.ok) {
    console.error(`fetchDue(${field}) failed:`, await res.text());
    return [];
  }
  return (await res.json()) as Booking[];
}

async function markSent(id: string, field: SentField) {
  await rest(`/rest/v1/bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ [field]: new Date().toISOString() }),
  });
}

const STUDIO_ADDRESS = "4 First Street East, deLa Marre Avenue, Trincity, Trinidad and Tobago — ground floor, inside A. Rauseo & Associates office.";
const GIFT_DESIGN_NAMES: Record<string, string> = {
  love: "Because I Love You",
  christmas: "Season's Greetings",
  milestone: "Congratulations",
};

type GiftRow = {
  id: string;
  design: string;
  amount: number;
  buyer_name: string;
  recipient_name: string;
  recipient_email: string | null;
  personal_message: string | null;
  signed_by: string | null;
  redemption_code: string;
  referral_voucher_code: string | null;
};

async function fetchGiftsDue() {
  const now = new Date().toISOString();
  const res = await rest(
    `/rest/v1/gift_certificates?select=id,design,amount,buyer_name,recipient_name,recipient_email,personal_message,signed_by,redemption_code,referral_voucher_code` +
      `&payment_status=eq.paid&sent_at=is.null&send_at=lte.${now}`
  );
  if (!res.ok) {
    console.error("fetchGiftsDue failed:", await res.text());
    return [];
  }
  return (await res.json()) as GiftRow[];
}

async function deliverGiftToRecipient(g: GiftRow) {
  if (!g.recipient_email) return;
  const name = firstName(g.recipient_name);
  const buyerFirst = firstName(g.buyer_name);
  const bookLink = `${SITE_URL}/book-eleganza.html?gift=${g.redemption_code}`;
  const messageBlock = g.personal_message ? `\n"${g.personal_message}"\n— ${g.signed_by || buyerFirst}\n` : `\n— ${g.signed_by || buyerFirst}\n`;
  const referralLine = g.referral_voucher_code
    ? `\n\nAs a little extra, here's a code to share with a friend for 10% off their first visit (expires in 24 hours): ${g.referral_voucher_code}`
    : "";
  const contactCard =
    `Eleganza Naturally Beautiful\n` +
    `Location: ${STUDIO_ADDRESS}\n` +
    (BUSINESS_WHATSAPP_NUMBER ? `WhatsApp: https://wa.me/${BUSINESS_WHATSAPP_NUMBER}\n` : "") +
    `Website: ${SITE_URL}/home.html`;

  await sendEmail(
    g.recipient_email,
    `You've received an Eleganza gift certificate! 🤍`,
    `Hi ${name},\n\n${buyerFirst} sent you a ${GIFT_DESIGN_NAMES[g.design] || g.design} gift certificate worth TT$${g.amount.toLocaleString()} at Eleganza Naturally Beautiful.\n${messageBlock}\n` +
      `Ready to book? Use this link — your gift is already linked to it:\n${bookLink}\n\n` +
      `Before you come in, take a look at the prep info and studio location on the booking page.\n\n` +
      `${contactCard}${referralLine}\n\nWhat once was, is not all lost.\nEleganza`,
    "eleganza"
  );
}

async function markGiftSent(id: string) {
  await rest(`/rest/v1/gift_certificates?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ sent_at: new Date().toISOString() }),
  });
}

Deno.serve(async () => {
  const results: Record<string, number> = { day_before: 0, hour_before: 0, followup: 0, two_week: 0, gifts: 0 };

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

  // Follow-up booking reminder: ~3 weeks after a 1st-application visit,
  // unless they already have a follow-up pending (booked via the checkout button)
  const followupDue = await fetchFollowupDue();
  const clientIds = [...new Set(followupDue.map((r) => r.client_id).filter((x): x is number => x != null))];
  const clientMap = await fetchClientsByIds(clientIds);
  for (const r of followupDue) {
    const alreadyBooked = r.client_id != null && (await hasUpcomingTouchUp(r.client_id));
    if (!alreadyBooked) {
      const client = r.client_id != null ? clientMap[r.client_id] : undefined;
      const name = firstName(r.client_name || "");
      const copy = followupCopy(name);
      if (client?.email) await sendEmail(client.email, copy.subject, copy.body, r.business);
      if (client?.phone) await sendWhatsApp(client.phone, WHATSAPP_TEMPLATE_FOLLOWUP, [name]);
      results.followup++;
    }
    await markFollowupSent(r.id);
  }

  // 2-week pay-and-confirm reminder for tentative bookings (e.g. a follow-up
  // booked at checkout for ~5 weeks out — this lands with 2 weeks' notice)
  const twoWeekDue = await fetchDue("two_week_sent_at", 13.5 * 24 * 60, 14.5 * 24 * 60, ["tentative"]);
  for (const b of twoWeekDue) {
    const copy = twoWeekCopy(b);
    if (b.client_email) await sendEmail(b.client_email, copy.subject, copy.body, b.business);
    if (b.client_phone) {
      await sendWhatsApp(b.client_phone, WHATSAPP_TEMPLATE_TWO_WEEK, [
        firstName(b.client_name),
        fmtDate(b.start_at),
        fmtTime(b.start_at),
      ]);
    }
    await markSent(b.id, "two_week_sent_at");
    results.two_week++;
  }

  // Scheduled gift certificate deliveries — buyer already paid, and either
  // asked for it to go out at a specific future time, or notify-gift's
  // immediate send attempt didn't fire (e.g. it errored). This sweep is
  // the reliable backstop for both.
  const giftsDue = await fetchGiftsDue();
  for (const g of giftsDue) {
    await deliverGiftToRecipient(g);
    await markGiftSent(g.id);
    results.gifts++;
  }

  return new Response(JSON.stringify({ ok: true, sent: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
