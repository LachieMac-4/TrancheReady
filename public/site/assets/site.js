// public/site/assets/site.js
(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Respect user preference; default to dark if nothing set
  const saved = localStorage.getItem('tr-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  const themeToggle = q('#themeToggle');
  themeToggle?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tr-theme', next);
  });

  // Smooth anchor scrolling
  qa('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id && id.length > 1) {
        const el = q(id);
        if (el) {
          e.preventDefault();
          const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
        }
      }
    });
  });

  // Back-to-top pill visibility
  const toTop = q('.to-top');
  const toggleTop = () => {
    if (!toTop) return;
    if (window.scrollY > 320) toTop.classList.add('show');
    else toTop.classList.remove('show');
  };
  window.addEventListener('scroll', toggleTop, { passive: true });
  toggleTop();

  // Stripe Checkout buttons (on /pricing)
  async function checkout(plan) {
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Checkout error');
      window.location.href = data.url;
    } catch (err) {
      alert(err.message || 'Unable to start checkout');
    }
  }
  qa('button[data-plan]').forEach(btn => btn.addEventListener('click', () => checkout(btn.getAttribute('data-plan'))));
})();
