// ============================================================
// calendar-feed — Supabase Edge Function
//
// Publishes upcoming/recent bookings (both businesses) as a standard
// .ics calendar feed, so Amii can subscribe to it once from Apple
// Calendar or Google Calendar and see every CRM booking alongside her
// personal calendar, always kept in sync automatically.
//
// This is deliberately read-only and one-way (CRM -> calendar app) —
// there's no write-back, so nothing about the booking system's own
// logic (slots, buffers, gift redemption, etc.) is affected.
//
// SECURITY: Apple Calendar / Google Calendar's "subscribe by URL"
// feature cannot send an Authorization header, so this function must
// be deployed with JWT verification OFF (a public URL). In its place,
// the URL itself carries a long random ?token= value that must match
// the CALENDAR_FEED_TOKEN secret — anyone without that exact token
// gets nothing back. Treat the full URL (with token) as a password:
// don't post it anywhere public.
//
// Required secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   -- auto-provided
//   CALENDAR_FEED_TOKEN                        -- set this yourself,
//                                                  same value that
//                                                  goes in the URL
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALENDAR_FEED_TOKEN = Deno.env.get("CALENDAR_FEED_TOKEN") || "";

const STUDIO_ADDRESS = "4 First Street East, deLa Marre Avenue, Trincity, Trinidad and Tobago";

const BUSINESS_LABELS: Record<string, string> = {
  eleganza: "Eleganza",
  enbfocus: "ENBfocus",
};

const STATUS_LABELS: Record<string, string> = {
  tentative: "Tentative",
  confirmed: "Confirmed",
  checked_in: "Checked In",
  completed: "Completed",
};

type BookingRow = {
  id: string;
  business: "eleganza" | "enbfocus";
  client_name: string;
  client_phone: string | null;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  services: { name: string; price: number | null; currency: string | null } | null;
};

const rest = (path: string) =>
  fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });

// RFC 5545 requires long lines folded at 75 octets, continuation lines
// starting with a single space.
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  let result = "";
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of line) {
    const chLen = new TextEncoder().encode(ch).length;
    if (chunkBytes + chLen > 74) {
      result += (result ? "\r\n " : "") + chunk;
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += chLen;
  }
  if (chunk) result += (result ? "\r\n " : "") + chunk;
  return result;
}

function escapeText(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function fmtICSDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fmtMoney(n: number | null, currency: string | null) {
  if (!n) return "";
  return `${currency || "TTD"}$${n.toLocaleString()}`;
}

function buildEvent(b: BookingRow): string {
  const businessLabel = BUSINESS_LABELS[b.business] || b.business;
  const serviceName = b.services?.name || "Appointment";
  const summary = `${businessLabel}: ${serviceName} — ${b.client_name}`;

  const descParts = [
    `Status: ${STATUS_LABELS[b.status] || b.status}`,
    b.client_phone ? `Phone: ${b.client_phone}` : null,
    b.services?.price ? `Price: ${fmtMoney(b.services.price, b.services.currency)}` : null,
    b.notes ? `Notes: ${b.notes}` : null,
  ].filter(Boolean);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${b.id}@enbbrows.github.io`,
    `DTSTAMP:${fmtICSDate(new Date().toISOString())}`,
    `DTSTART:${fmtICSDate(b.start_at)}`,
    `DTEND:${fmtICSDate(b.end_at)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(descParts.join("\\n"))}`,
    `STATUS:${b.status === "tentative" ? "TENTATIVE" : b.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
  ];
  if (b.business === "eleganza") lines.push(`LOCATION:${escapeText(STUDIO_ADDRESS)}`);
  lines.push("END:VEVENT");

  return lines.map(foldLine).join("\r\n");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!CALENDAR_FEED_TOKEN || token !== CALENDAR_FEED_TOKEN) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const res = await rest(
      `/rest/v1/bookings?select=id,business,client_name,client_phone,start_at,end_at,status,notes,services(name,price,currency)` +
        `&status=in.(tentative,confirmed,checked_in,completed)&start_at=gte.${from}&order=start_at.asc`
    );
    const rows = (await res.json()) as BookingRow[];

    const events = rows.map(buildEvent).join("\r\n");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Eleganza CRM//Booking Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Eleganza + ENBfocus Bookings",
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
      "X-PUBLISHED-TTL:PT15M",
      events,
      "END:VCALENDAR",
    ].join("\r\n");

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  } catch (e) {
    console.error("calendar-feed error:", e);
    return new Response("Server error", { status: 500 });
  }
});
