/* ═════════════════════════════════════════════════════════
   Remembers a client's own name/phone/email on THEIR device
   (localStorage), so pages they open themselves — booking, gift
   purchase, aftercare — can skip re-asking for details already on
   file. Never used to auto-select a DIFFERENT person's identity on
   a shared/front-desk device; only this page's own save/read.
   ═════════════════════════════════════════════════════════ */
const ClientIdentity = {
  KEY: "eleganza_identity",

  get() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || !v.phone) return null;
      return v;
    } catch (e) {
      return null;
    }
  },

  save(identity) {
    try {
      const existing = this.get() || {};
      const merged = Object.assign({}, existing, identity);
      Object.keys(merged).forEach(k => { if (!merged[k]) delete merged[k]; });
      localStorage.setItem(this.KEY, JSON.stringify(merged));
    } catch (e) {
      /* private browsing / storage blocked — fine, just means no memory this time */
    }
  },

  clear() {
    try { localStorage.removeItem(this.KEY); } catch (e) {}
  }
};
