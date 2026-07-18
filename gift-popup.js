/* ═══════════════════════════════════════════════════════════
   Eleganza gift certificate popup — shows once per browser session,
   a few seconds after landing on the page, as a closeable bubble
   rather than a dedicated featured section. Ducks the ambience music
   (if playing) while it's open and brings it back when closed.

   Include on any page with: <script src="gift-popup.js"></script>
   (after ambience.js, so window.EleganzaAmbience already exists)
   ═══════════════════════════════════════════════════════════ */
(function () {
  if (sessionStorage.getItem("eleganza-gift-popup-seen")) return;

  const style = document.createElement("style");
  style.textContent = `
    .gift-popup-overlay{
      position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:90;
      display:none;align-items:center;justify-content:flex-start;padding:20px;
    }
    .gift-popup-overlay.show{display:flex}
    .gift-popup{
      position:relative;max-width:300px;width:100%;background:#171210;
      border:1px solid #C9A26B;border-radius:16px 4px 16px 4px;padding:30px 22px 26px;text-align:center;
      animation:gift-pop-in .35s ease both;font-family:'Karla',sans-serif;
    }
    @keyframes gift-pop-in{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
    .gift-popup-close{
      position:absolute;top:8px;right:8px;background:transparent;border:none;color:#B9AC9D;
      font-size:1.1rem;cursor:pointer;width:34px;height:34px;line-height:1;
    }
    .gift-popup-sparkle{position:absolute;inset:0;pointer-events:none;overflow:visible}
    .gift-popup .spark{position:absolute;color:#E0BE8A;font-size:.9rem;opacity:0;animation:spark-twinkle 2.6s ease-in-out infinite}
    .gift-popup .s1{top:6%;left:8%;animation-delay:0s}
    .gift-popup .s2{top:12%;right:12%;animation-delay:.5s;font-size:.7rem}
    .gift-popup .s3{bottom:22%;left:6%;animation-delay:1s;font-size:1.1rem}
    .gift-popup .s4{bottom:12%;right:10%;animation-delay:1.5s}
    .gift-popup .s5{top:48%;left:4%;animation-delay:2s;font-size:.7rem}
    .gift-popup .s6{top:40%;right:6%;animation-delay:.8s;font-size:.8rem}
    @keyframes spark-twinkle{0%,100%{opacity:0;transform:scale(.4) rotate(0deg)}50%{opacity:1;transform:scale(1) rotate(45deg)}}
    .gift-popup-motif{width:52px;height:52px;margin:6px auto 0}
    .gift-popup-title{font-family:'Fraunces',serif;font-style:italic;color:#E0BE8A;font-size:1.25rem;margin-top:14px}
    .gift-popup-sub{color:#B9AC9D;font-size:.84rem;line-height:1.5;margin-top:8px}
    .gift-popup-btn{
      display:block;width:100%;margin-top:18px;padding:14px;background:#C9A26B;color:#171210;
      text-decoration:none;border-radius:2px;font-weight:600;font-size:.78rem;letter-spacing:.2em;
      text-transform:uppercase;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.className = "gift-popup-overlay";
  overlay.id = "giftPopupOverlay";
  overlay.innerHTML = `
    <div class="gift-popup">
      <button class="gift-popup-close" id="giftPopupClose" aria-label="Close">✕</button>
      <div class="gift-popup-sparkle" aria-hidden="true">
        <span class="spark s1">✦</span><span class="spark s2">✦</span><span class="spark s3">✦</span>
        <span class="spark s4">✦</span><span class="spark s5">✦</span><span class="spark s6">✦</span>
      </div>
      <svg class="gift-popup-motif" viewBox="0 0 64 64" fill="none"><path d="M32 54s-22-13-22-29c0-8 6-14 14-14 4 0 8 2 8 6 0-4 4-6 8-6 8 0 14 6 14 14 0 16-22 29-22 29z" stroke="#C9A26B" stroke-width="1.4"/></svg>
      <p class="gift-popup-title">Give the Gift of Confidence</p>
      <p class="gift-popup-sub">Eleganza gift certificates — the perfect surprise for someone who deserves it.</p>
      <a class="gift-popup-btn" href="gift-eleganza.html">Give A Gift</a>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() {
    overlay.classList.remove("show");
    if (window.EleganzaAmbience) window.EleganzaAmbience.unduck();
  }
  document.getElementById("giftPopupClose").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  setTimeout(() => {
    overlay.classList.add("show");
    sessionStorage.setItem("eleganza-gift-popup-seen", "1");
    if (window.EleganzaAmbience) window.EleganzaAmbience.duck();
  }, 2200);
})();
