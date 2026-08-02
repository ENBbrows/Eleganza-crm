// ============================================================
// _shared/copy.ts — client-facing message copy shared between
// edge functions. Currently holds the gift-delivery email, which
// was previously hand-duplicated identically in both
// notify-gift/index.ts and send-reminders/index.ts. Import from
// here instead of inlining it again.
// ============================================================

export type GiftDeliveryInput = {
  recipientName: string;
  buyerName: string;
  design: string;
  amount: number;
  openLink: string;
  referralVoucherCode: string | null;
  studioAddress: string;
  businessWhatsappNumber: string;
  siteUrl: string;
};

export const GIFT_DESIGN_NAMES: Record<string, string> = {
  love: "Because I Love You",
  christmas: "Season's Greetings",
  milestone: "Congratulations",
};

export function firstName(name: string): string {
  return (name || "there").split(" ")[0];
}

export function giftDeliveryEmail(input: GiftDeliveryInput): { subject: string; body: string } {
  const name = firstName(input.recipientName);
  const buyerFirst = firstName(input.buyerName);
  const designLabel = GIFT_DESIGN_NAMES[input.design] || input.design;

  const referralLine = input.referralVoucherCode
    ? `\n\nA code to share with a friend, for 10% off their first visit (expires in 24 hours): ${input.referralVoucherCode}`
    : "";

  const contactCard =
    `Eleganza Naturally Beautiful\n` +
    `Location: ${input.studioAddress}\n` +
    (input.businessWhatsappNumber ? `WhatsApp: https://wa.me/${input.businessWhatsappNumber}\n` : "") +
    `Website: ${input.siteUrl}/home.html`;

  return {
    subject: `You've received an Eleganza gift certificate`,
    body:
      `Hi ${name},\n\n${buyerFirst} sent you a ${designLabel} gift certificate, worth TT$${input.amount.toLocaleString()}, at Eleganza Naturally Beautiful.\n\n` +
      `Open it here:\n${input.openLink}\n\n` +
      `Booking is linked from there when you're ready. Before you come in, the prep info and studio location are on the booking page.\n\n` +
      `${contactCard}${referralLine}\n\nWhat once was, is not all lost.\nEleganza`,
  };
}
