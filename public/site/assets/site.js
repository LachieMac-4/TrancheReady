// public/site/assets/site.js
(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Theme toggle
  const themeToggle = q('#themeToggle');
  const root = document.documentElement;

  const saved = localStorage.getItem('tr-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  themeToggle?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tr-theme', next);
  });

  // Smooth scroll anchors
  qa('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id.length > 1) {
        const el = q(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // Stripe Checkout: call our backend to create a session
  async function checkout(plan) {
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Checkout error');
      window.location.href = data.url; // redirect to Stripe
    } catch (err) {
      alert(err.message || 'Unable to start checkout');
    }
  }

  qa('button[data-plan]').forEach(btn => {
    btn.addEventListener('click', () => checkout(btn.getAttribute('data-plan')));
  });

  // Minor visual polish: add wave gradient on hero
  function paintWaves() {
    const body = document.body;
    body.style.setProperty('--wave01', 'radial-gradient(1200px 600px at 20% 0%, rgba(36,85,255,0.25), transparent 60%)');
    body.style.setProperty('--wave02', 'radial-gradient(1600px 700px at 90% -10%, rgba(122,163,255,0.18), transparent 60%)');
  }
  paintWaves();
})();
