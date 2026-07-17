# Booking & Calendar System — Setup Guide

This adds a full booking calendar for both businesses on top of the existing
Supabase project, plus check-in → CRM linkage and a reminder engine.

## New pages

| Page | Who uses it | Purpose |
|---|---|---|
| `book-eleganza.html` | Microblading clients | Pick a service, pick a time, book |
| `book-enbfocus.html` | ENBfocus leads | Book a 15-min discovery call + intake form |
| `confirm.html` | Anyone with a reminder link | Confirm or reschedule via the day-before message |
| `admin-calendar.html` | You | Week view, confirm/cancel/reschedule, block time off, reminders-due panel |
| `checkin.html` | Existing — now also | Matches today's booking, marks it checked-in, logs a receipt |

Link `book-eleganza.html` and `book-enbfocus.html` from your bio / website —
these are the public booking pages, same idea as a Calendly link.

## 1. Run the database migration

Open your Supabase project → **SQL Editor** → paste the contents of
`supabase/migrations/0001_booking_system.sql` → Run.

This creates: `services`, `availability_rules`, `availability_blocks`,
`bookings`, `receipts`, `enbfocus_leads`, plus the RPC functions the booking
pages call (`get_booking_schedule`, `create_booking`, `confirm_booking`,
`reschedule_booking`, `cancel_booking`, `checkin_booking_by_phone`,
`log_receipt`). It also seeds starter services and business hours — edit
these anytime from `admin-calendar.html` → **+ New booking** / **Block time
off**, or directly in the `services` / `availability_rules` tables.

**One thing to check:** `bookings.client_id` is a `bigint` with no foreign
key (to avoid guessing your `Clients` table's exact primary key type). If
your `Clients.id` isn't a `bigint`, the linkage still works loosely (it's
just used to advance a client's pipeline stage) but won't be a true foreign
key — that's fine for how it's used.

## 2. Edit `config.js`

Set your own WhatsApp number so clients can message you before arriving:

```js
BUSINESS_WHATSAPP_NUMBER: "18685551234", // international format, digits only, no +
```

## 3. Set up email reminders (Resend)

1. Create a free account at resend.com and verify a sending domain (or use
   their shared test domain to start).
2. Grab an API key.
3. Deploy the edge function and set secrets (see step 5).

## 4. Set up WhatsApp automation (Meta Cloud API)

Automated WhatsApp messages that fire on a timer (not tapped by you) require
Meta's WhatsApp Business Platform:

1. Create a Meta Business Account and a WhatsApp Business app in
   [developers.facebook.com](https://developers.facebook.com).
2. Add and verify a phone number for sending.
3. Create two **message templates** (Meta requires pre-approval for any
   business-initiated message — this can take 24-48h):
   - `appointment_day_before` — body with 4 placeholders: client first name,
     date, time, confirm link. Matches what `send-reminders/index.ts` sends.
   - `appointment_hour_before` — body with 2 placeholders: client first name,
     time.
4. Once approved, grab your permanent access token and phone number ID.

**Until templates are approved**, leave `WHATSAPP_TOKEN` unset. The reminder
engine still runs and still sends email — WhatsApp sends are skipped safely.
In the meantime, use `admin-calendar.html`'s **Reminders due** panel: it
lists every booking that needs a day-before or hour-before touch and gives
you a one-tap pre-filled WhatsApp link to send from your own phone, plus a
"Mark sent" button so it won't nag you twice.

## 5. Deploy the reminder edge function

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy send-reminders

supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set RESEND_FROM_ELEGANZA="Eleganza <hello@enbfocus.com>"
supabase secrets set RESEND_FROM_ENBFOCUS="ENBfocus <hello@enbfocus.com>"
supabase secrets set BUSINESS_WHATSAPP_NUMBER=18684733030
supabase secrets set SITE_URL=https://enbbrows.github.io/Eleganza-crm
supabase secrets set WAM_HANDLE=@amiileroux

# Add these once WhatsApp templates are approved:
supabase secrets set WHATSAPP_TOKEN=xxx
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=xxx
supabase secrets set WHATSAPP_TEMPLATE_DAY_BEFORE=appointment_day_before
supabase secrets set WHATSAPP_TEMPLATE_HOUR_BEFORE=appointment_hour_before
supabase secrets set WHATSAPP_TEMPLATE_FOLLOWUP=book_your_followup
supabase secrets set WHATSAPP_TEMPLATE_TWO_WEEK=pay_and_confirm_followup
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to
edge functions — you don't need to set those yourself.

## 6. Schedule it (Supabase Cron)

In the Supabase dashboard → **Database → Cron Jobs** (or via SQL using
`pg_cron` + `pg_net`), create a job that calls the function every 15
minutes:

```sql
select cron.schedule(
  'send-reminders-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>')
  );
  $$
);
```

(The Cron Jobs UI in the dashboard can do this without writing SQL, if you
prefer — point it at the function URL on a 15-minute schedule.)

## How the flow works end to end

- **Eleganza**: a client books via `book-eleganza.html`. Services flagged
  "requires confirmation" start as **tentative**; everything else is
  **confirmed** immediately (standard Calendly-style booking). 23-25h before
  the appointment, everyone gets a day-before message — tentative bookings
  are asked to confirm or reschedule, confirmed ones just get a reminder.
  ~1h before, a reminder goes out that also points local clients to your
  WhatsApp. When the client checks in via `checkin.html`, today's booking is
  automatically matched by phone, marked `checked_in`, and a receipt is
  logged — no manual step on your end.
- **ENBfocus**: a lead books a 15-min discovery call via
  `book-enbfocus.html`, answering a short intake (business/platform, what
  their audience is asking for, revenue goals) — this creates a row in
  `enbfocus_leads` with a lightweight pipeline (`lead → discovery_booked →
  discovery_done → proposal → client / not_a_fit`), visible and editable in
  `admin-calendar.html`'s ENBfocus tab. Day-before sends a confirm/reschedule
  link; hour-before sends the "all set for the call, see you at …" message.

## Known trade-off (by design, not a bug)

`create_booking` doesn't re-validate that a slot falls within business hours
server-side — only that it doesn't overlap another booking. The booking
pages only ever offer in-hours slots, and `admin-calendar.html` is
authenticated-only, so this is a low-risk gap (a scripted call to the public
RPC could in theory book an odd hour) rather than something clients can hit
by using the site normally. Worth hardening later if that ever matters.
