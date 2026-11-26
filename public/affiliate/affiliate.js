/* ===== CONFIG ===== */
const CONFIG = {
  joinUrl: "https://www.clickbank.com/",  // <-- replace with your ClickBank affiliate/marketplace link
  founderName: "",                         // <-- your name, e.g. "Jordan Smith, Founder" (blank = hidden)
  tierRule: "",                            // <-- your official tier rule, e.g. "Your rate steps up after every 100 sales." (blank = generic text)
  parallax: true,
  depth: 1
};

document.querySelectorAll('[data-join]').forEach(a => { a.href = CONFIG.joinUrl; });
document.querySelectorAll('[data-founder-name]').forEach(el => {
  if (CONFIG.founderName) el.textContent = CONFIG.founderName; else el.remove();
});
if (CONFIG.tierRule) document.querySelectorAll('[data-tier-rule]').forEach(el => { el.textContent = CONFIG.tierRule; });

(function () {
  let t = 0, on = false;
  window.addEventListener('scroll', () => {
    if (!on) { on = true; document.documentElement.classList.add('is-scrolling'); }
    clearTimeout(t);
    t = setTimeout(() => { on = false; document.documentElement.classList.remove('is-scrolling'); }, 140);
  }, { passive: true });
})();

(function () {
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!CONFIG.parallax || reduce) {
    root.style.setProperty('--depth', 0);
    document.querySelectorAll('.scene-bg,.scene-mid,.scene .float').forEach(el => { el.style.animation = 'none'; });
    return;
  }
  const small = window.matchMedia('(max-width:760px)');
  const setDepth = () => root.style.setProperty('--depth', Math.max(0, Math.min(1.4, CONFIG.depth)) * (small.matches ? 0.6 : 1));
  setDepth();
  if (small.addEventListener) small.addEventListener('change', setDepth);
  if (window.CSS && CSS.supports('animation-timeline: view()')) return;

  // Fallback (e.g. Firefox): one rAF per frame, transforms only, no layout reads while scrolling.
  const depth = () => parseFloat(root.style.getPropertyValue('--depth')) || 0;
  const scenes = [...document.querySelectorAll('.scene')].map(el => ({ el, bg: el.querySelector('.scene-bg'), mid: el.querySelector('.scene-mid') }));
  const cards = [...document.querySelectorAll('.float')].map(el => ({ el, sh: el.querySelector('.cast'), rise: !!el.closest('.scene') }));
  let vh = 0, queued = false;
  const docTop = el => el.getBoundingClientRect().top + window.scrollY;
  function measure() {
    vh = window.innerHeight;
    scenes.forEach(s => { s.top = docTop(s.el); s.h = s.el.offsetHeight; s.bgH = s.bg.offsetHeight; s.midH = s.mid ? s.mid.offsetHeight : 0; });
    cards.forEach(c => { c.el.style.transform = ''; c.top = docTop(c.el); c.h = c.el.offsetHeight; });
    frame();
  }
  const progress = (y, top, h) => Math.max(0, Math.min(1, (y + vh - top) / (h + vh)));
  function frame() {
    queued = false;
    const y = window.scrollY, d = depth();
    scenes.forEach(s => {
      if (y + vh < s.top - 100 || y > s.top + s.h + 100) return;
      const p = progress(y, s.top, s.h);
      s.bg.style.transform = 'translate3d(0,' + ((p - 0.5) * 0.40 * s.bgH * d).toFixed(2) + 'px,0)';
      if (s.mid) s.mid.style.transform = 'translate3d(0,' + ((p - 0.5) * 0.16 * s.midH * d).toFixed(2) + 'px,0)';
    });
    cards.forEach(c => {
      if (y + vh < c.top - 100 || y > c.top + c.h + 100) return;
      const p = progress(y, c.top, c.h);
      if (c.rise) c.el.style.transform = 'translate3d(0,' + ((0.5 - p) * 112 * d).toFixed(2) + 'px,0)';
      c.sh.style.transform = 'translate3d(0,' + (p * 80 - 10).toFixed(1) + 'px,0) scale(' + (0.92 + p * 0.1).toFixed(3) + ')';
      c.sh.style.opacity = (0.5 + p * 0.4).toFixed(3);
    });
  }
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(document.body);
  measure();
})();
