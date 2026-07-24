/* ═════════════════════════════════════════════════════════
   Shared top-nav behavior for every page except home.html
   (home.html has its own inline copy since its search targets
   sections on itself rather than redirecting to home.html#id).
   Wires up the dropdown toggle + search box already present in
   the page's own HTML (see the .topnav markup in each file).
   ═════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const navToggle = $("navToggle");
  const navDropdown = $("navDropdown");
  if (!navToggle || !navDropdown) return;

  navToggle.addEventListener("click", () => {
    const open = navDropdown.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  navDropdown.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    navDropdown.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }));

  const SEARCH_MAP = [
    [["artist","amii","about","bio","credentials","certified","certification","story","started","who is amii","meet"], "artist"],
    [["how it works","process","steps","journey","what happens"], "how"],
    [["services","pricing","price","cost","menu","microblading","3d","touch up","touch-up","consultation"], "services"],
    [["faq","question","questions","pain","hurt","safe","safety","who is this for","invest","why","heal","healing"], "faq"],
    [["testimonial","testimonials","what clients say","kind words"], "testimonials"],
    [["visit","location","address","studio","policy","late","deposit","payment","wam","hours","tip"], "visit"],
    [["work","before","after","instagram","tiktok","portfolio","results"], "work"],
    [["review","leave a review","google","facebook"], "reviews"],
    [["book","appointment","schedule","booking"], "__book__"],
    [["gift","gift certificate","gift card","present"], "__gift__"]
  ];

  const form = $("navSearchForm");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const input = $("navSearch");
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    let target = null;
    outer:
    for (const [keywords, id] of SEARCH_MAP) {
      for (const kw of keywords) {
        if (q.includes(kw) || kw.includes(q)) { target = id; break outer; }
      }
    }
    if (target === "__book__") { location.href = "book-eleganza.html"; return; }
    if (target === "__gift__") { location.href = "gift-eleganza.html"; return; }
    if (target) { location.href = "home.html#" + target; return; }
    const original = input.placeholder;
    input.placeholder = "No match — try 'pricing' or 'FAQ'";
    input.value = "";
    setTimeout(() => { input.placeholder = original; }, 2500);
  });
})();
