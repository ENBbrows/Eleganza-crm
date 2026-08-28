/* ═══════════════════════════════════════════════════════════
   Eleganza persistent WhatsApp bubble — a fixed, always-visible
   click-to-chat button (bottom-right) that opens a chat with the
   studio's WhatsApp Business number, prefilled with a friendly
   greeting. Stays on screen through scroll, on every page.

   Include on any page with:
     <script src="config.js"></script>
     <script src="whatsapp-widget.js"></script>
   (config.js first, so CONFIG.BUSINESS_WHATSAPP_NUMBER exists)

   If ambience.js is also on the page, its floating music badge
   stacks above this bubble rather than overlapping it.
   ═══════════════════════════════════════════════════════════ */
(function () {
  if (typeof CONFIG === "undefined" || !CONFIG.BUSINESS_WHATSAPP_NUMBER || CONFIG.BUSINESS_WHATSAPP_NUMBER.indexOf("PASTE_") === 0) return;

  const style = document.createElement("style");
  style.textContent = `
    .wa-widget{
      position:fixed;bottom:20px;right:20px;z-index:85;
      width:56px;height:56px;border-radius:50%;
      background:#25D366;display:flex;align-items:center;justify-content:center;
      box-shadow:0 6px 18px rgba(0,0,0,.22);cursor:pointer;text-decoration:none;
      animation:wa-pop-in .4s ease both, wa-pulse 2.6s ease-in-out 1s infinite;
    }
    .wa-widget svg{width:29px;height:29px;display:block}
    @keyframes wa-pop-in{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
    @keyframes wa-pulse{
      0%,100%{box-shadow:0 6px 18px rgba(0,0,0,.22),0 0 0 0 rgba(37,211,102,.45)}
      50%{box-shadow:0 6px 18px rgba(0,0,0,.22),0 0 0 10px rgba(37,211,102,0)}
    }
    @media (prefers-reduced-motion:reduce){.wa-widget{animation:none}}
  `;
  document.head.appendChild(style);

  const link = document.createElement("a");
  link.className = "wa-widget";
  link.id = "waWidget";
  link.href = `https://wa.me/${CONFIG.BUSINESS_WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi Eleganza! I have a question 🌿")}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.setAttribute("aria-label", "Message us on WhatsApp");
  link.innerHTML = `<svg viewBox="0 0 32 32" fill="#fff" aria-hidden="true"><path d="M16.02 3C9.4 3 4 8.4 4 15.02c0 2.36.66 4.56 1.8 6.44L4 29l7.72-1.76a11.94 11.94 0 0 0 4.3.8h.01c6.62 0 12.02-5.4 12.02-12.02C28.05 8.4 22.65 3 16.02 3zm0 21.9h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.75.86.86-3.66-.24-.37a9.85 9.85 0 0 1-1.5-5.24c0-5.46 4.44-9.9 9.9-9.9 5.46 0 9.9 4.44 9.9 9.9 0 5.46-4.44 10-9.75 10zm5.44-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.24-.46-2.36-1.46-.87-.78-1.46-1.73-1.63-2.03-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.6-.9-2.2-.24-.58-.48-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.06 2.87 1.2 3.07.15.2 2.1 3.2 5.08 4.5.71.3 1.26.49 1.7.62.72.23 1.36.2 1.88.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>`;

  document.body.appendChild(link);
})();
