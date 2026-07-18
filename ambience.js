/* ═══════════════════════════════════════════════════════════
   Eleganza shared ambience — seasonal music + a floating, pulsing
   lotus badge that IS the play/pause button.

   Include on any page with: <script src="ambience.js"></script>
   No other setup needed — it injects its own styles and appends
   itself to the page.

   Browsers block audio from auto-playing with sound, so this can only
   ever start on a real tap — that's a platform rule, not a choice made
   here. The badge glows gently before it's tapped and shows a
   "Tap for Music" label for a few seconds on load so it's unmistakable
   which button starts it. Once playing, the badge (and any element with
   class "lotus" elsewhere on the page) pulses in real time to the
   track's actual frequency data, not a canned animation. The badge is
   fixed-position, so it — and its pulse — stay visible the whole time
   you scroll.

   Other scripts on the page (e.g. a popup with its own audio/video) can
   call window.EleganzaAmbience.duck() / .unduck() to lower this music
   out of the way and bring it back.
   ═══════════════════════════════════════════════════════════ */
(function () {
  const SEASON_TRACKS = [
    { months: [2, 3], file: "audio/season-soca.mp3", label: "Soca" },
    { months: [4, 5, 6], file: "audio/season-love.mp3", label: "Love Song" },
    { months: [7, 8], file: "audio/season-sunset.mp3", label: "Sunset House" },
    { months: [9, 10], file: "audio/season-darktrap.mp3", label: "Dark Trap" },
    { months: [11, 12, 1], file: "audio/season-christmas.mp3", label: "Christmas" }
  ];
  function currentSeasonTrack() {
    const m = new Date().getMonth() + 1; // 1-12
    return SEASON_TRACKS.find(s => s.months.includes(m)) || null;
  }
  const track = currentSeasonTrack();

  const style = document.createElement("style");
  style.textContent = `
    .amb-badge{
      position:fixed;bottom:20px;right:20px;z-index:80;
      width:60px;height:60px;border-radius:50%;
      background:#171210;border:1px solid #C9A26B;
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.5);
      animation:amb-idle 2.4s ease-in-out infinite;
    }
    .amb-badge img{width:30px;height:auto;display:block;transition:transform .08s linear}
    .amb-hint{
      position:absolute;bottom:72px;right:0;white-space:nowrap;
      background:#241C18;border:1px solid #C9A26B;color:#E0BE8A;
      font-family:'Karla',sans-serif;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;
      padding:7px 12px;border-radius:14px;opacity:0;pointer-events:none;transition:opacity .3s;
    }
    .amb-hint.show{opacity:1}
    @keyframes amb-idle{
      0%,100%{box-shadow:0 6px 20px rgba(0,0,0,.5),0 0 0 0 rgba(201,162,107,.45)}
      50%{box-shadow:0 6px 20px rgba(0,0,0,.5),0 0 0 12px rgba(201,162,107,0)}
    }
    .amb-badge.playing{animation:none}
    .lotus{transition:transform .08s linear}
  `;
  document.head.appendChild(style);

  if (!track) return; // no track configured for this month yet

  const badge = document.createElement("div");
  badge.className = "amb-badge";
  badge.id = "ambienceBadge";
  badge.innerHTML = `<img src="logo-gold.png" alt="Play ambience music" /><span class="amb-hint" id="ambHint">🎵 Tap for Music</span>`;
  document.body.appendChild(badge);
  const hint = document.getElementById("ambHint");
  setTimeout(() => hint.classList.add("show"), 700);
  setTimeout(() => hint.classList.remove("show"), 6000);
  badge.addEventListener("mouseenter", () => hint.classList.add("show"));
  badge.addEventListener("mouseleave", () => { if (!playing) hint.classList.remove("show"); });

  let audio = null, audioCtx = null, analyser = null, dataArray = null, rafId = null, playing = false, ducked = false;

  function pulseLoop() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    const n = Math.min(24, dataArray.length); // low-mid frequencies read as the "beat"
    for (let i = 0; i < n; i++) sum += dataArray[i];
    const avg = sum / n / 255;
    const scale = 1 + avg * 0.22;
    document.querySelectorAll(".lotus, .amb-badge img").forEach(el => { el.style.transform = `scale(${scale})`; });
    rafId = requestAnimationFrame(pulseLoop);
  }

  function ensureAudio() {
    if (audio) return;
    audio = new Audio(track.file);
    audio.loop = true;
    audio.volume = 0.5;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  function start() {
    ensureAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    audio.play();
    pulseLoop();
    badge.classList.add("playing");
    hint.textContent = "🔇 Pause " + track.label;
    hint.classList.add("show");
    setTimeout(() => hint.classList.remove("show"), 2500);
    playing = true;
  }
  function stop() {
    if (audio) audio.pause();
    cancelAnimationFrame(rafId);
    document.querySelectorAll(".lotus, .amb-badge img").forEach(el => { el.style.transform = "scale(1)"; });
    badge.classList.remove("playing");
    hint.textContent = "🎵 Tap for Music";
    playing = false;
  }

  badge.addEventListener("click", () => { playing ? stop() : start(); });

  // Exposed so other on-page scripts (e.g. a gift popup) can duck this
  // music out of the way and bring it back, without stopping it outright.
  window.EleganzaAmbience = {
    duck() { if (audio && playing && !ducked) { audio.volume = 0.08; ducked = true; } },
    unduck() { if (audio && ducked) { audio.volume = 0.5; ducked = false; } },
    isPlaying: () => playing,
    trackLabel: track.label
  };
})();
