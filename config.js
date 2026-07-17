/* ═════════════════════════════════════════════════════════
   ELEGANZA SETTINGS — paste your values here ONCE.
   Future updates to checkin.html will never touch this file.
   ═════════════════════════════════════════════════════════ */
const CONFIG = {
  SUPABASE_URL: "https://iarygyqjsdjhibtyhncb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhcnlneXFqc2RqaGlidHlobmNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzgxMDMsImV4cCI6MjA5ODQxNDEwM30.BZmRug89XMlAlnJtSLmuIVsh_kQMkgb5pW_EOCZcCCk",   /* copy from index.html — the long eyJ... string */
  TABLE: "Clients",

  EMAILJS_PUBLIC_KEY: "4foLQZ3s5wcPOfbs4",
  EMAILJS_SERVICE: "service_wik9yvb",
  EMAILJS_TEMPLATE: "template_egmgzho",

  GOOGLE_REVIEW_URL: "https://g.page/r/CX5CbuaQjUY5EAE/review",
  FACEBOOK_REVIEW_URL: "https://www.facebook.com/eleganzanaturallybeautiful",

  /* Your own WhatsApp number (international format, digits only, no +).
     Used for the "message me on WhatsApp" links shown to local clients
     before their appointment and after booking. e.g. "18685551234" */
  BUSINESS_WHATSAPP_NUMBER: "18684733030",

  /* Your WAM! handle/number clients send payment to (personal WAM! account —
     no merchant API, so this just displays instructions; you confirm receipt
     yourself when completing the booking in the CRM's Calendar tab). */
  WAM_HANDLE: "@amiileroux",

  /* The Eleganza Effect — tune these to your market */
  VALUE_MATH: {
    pencilCost: 120,      /* TT$ per brow pencil/kit */
    pencilsPerYear: 8,    /* how many they'd buy in a year */
    minutesPerDay: 8      /* daily time spent penciling brows */
  },

  /* Where clients can learn brow tips & tricks */
  YOUTUBE_URL: "PASTE_YOUR_YOUTUBE_CHANNEL_LINK",
  INSTAGRAM_URL: "PASTE_YOUR_INSTAGRAM_LINK",
  FACEBOOK_PAGE_URL: "PASTE_YOUR_FACEBOOK_PAGE_LINK",

  /* Column names in your Clients table */
  COLUMNS: {
    name: "name",
    phone: "phone",
    email: "email",
    birthday: "birthday",
    service: "service",
    lastVisit: "last_visit",
    visitCount: "visit_count",
    price: "price",
    totalSpent: "total_spent",
    nextDiscount: "next_visit_discount"
  }
};
