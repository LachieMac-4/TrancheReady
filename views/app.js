<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrancheReady — App</title>
  <link rel="stylesheet" href="/site/assets/style.css" />
  <style>
    main.container { padding-bottom: 40px; }
    .grid { display:grid; grid-template-columns: 1.2fr .8fr; gap:18px; }
    @media (max-width: 960px){ .grid{ grid-template-columns:1fr; } }
    .drop {
      border: 1.5px dashed rgba(230,234,242,0.25);
      border-radius: var(--radius);
      background: var(--panel);
      padding: 16px;
      text-align: center;
      color: #cfe0ff;
    }
    .drop input { display: none; }
    .status { font-family: ui-monospace, Menlo, Consolas, monospace; background:#0B1733; padding:12px; border-radius:10px; border:1px solid rgba(230,234,242,.12); color:#aecdff; white-space:pre-wrap; }
    .kpi { display:flex; gap:10px; flex-wrap:wrap; }
    .pill.kpi { background:#0B1733; border:1px solid rgba(230,234,242,.12); color:#cfe0ff; }
    .cta-row{ display:flex; gap:10px; flex-wrap:wrap; }
  </style>
</head>
<body>
  <header class="nav glass">
    <a class="brand" href="/"><span class="logo-dot"></span>TrancheReady</a>
    <nav>
      <a href="/features">Features</a>
      <a href="/pricing">Pricing</a>
      <a href="/faq">FAQ</a>
      <button id="themeToggle" class="pill">Toggle</button>
    </nav>
  </header>

  <main class="container">
    <section class="hero hero--short">
      <h1>Generate your evidence pack</h1>
      <p class="lead">Upload <strong>Clients.csv</strong> and <strong>Transactions.csv</strong>. We’ll validate, score, and produce a signed ZIP + verify link.</p>
      <div class="kpi" style="margin-top:12px">
        <a class="pill" href="/api/templates?name=clients">Download Clients.csv template</a>
        <a class="pill" href="/api/templates?name=transactions">Download Transactions.csv template</a>
      </div>
    </section>

    <section class="grid">
      <div class="card">
        <form id="uploadForm">
          <div class="drop">
            <label class="btn">
              <input type="file" id="clients" accept=".csv" />
              Select Clients.csv
            </label>
            <span style="display:inline-block;width:12px"></span>
            <label class="btn">
              <input type="file" id="transactions" accept=".csv" />
              Select Transactions.csv
            </label>
            <p class="muted" style="margin-top:8px">We only accept CSV. Files are processed in memory.</p>
          </div>

          <div class="cta-row" style="margin-top:12px">
            <button type="button" id="btnValidate" class="btn">Validate</button>
            <button type="button" id="btnGenerate" class="btn btn-primary">Generate Evidence</button>
          </div>
        </form>

        <div style="margin-top:12px">
          <div id="status" class="status" aria-live="polite">Waiting for files…</div>
        </div>
      </div>

      <div class="card">
        <h3>Output</h3>
        <p class="muted">Once generated, your verify link and ZIP download will appear here.</p>
        <div id="result" class="status">No output yet.</div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="container footer-inner">
      <div class="brand">TrancheReady</div>
      <nav>
        <a href="/features">Features</a>
        <a href="/pricing">Pricing</a>
        <a href="/faq">FAQ</a>
        <a href="/site/privacy.html">Privacy</a>
      </nav>
    </div>
  </footer>

  <script src="/site/assets/site.js"></script>
  <script>
    const $ = (s, r=document)=>r.querySelector(s);
    const statusEl = $('#status');
    const resultEl = $('#result');
    const clientsInput = $('#clients');
    const txInput = $('#transactions');

    function setStatus(obj){ statusEl.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); }
    function setResult(obj){ resultEl.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); }

    function getFormData() {
      const fd = new FormData();
      if (clientsInput.files[0]) fd.append('clients', clientsInput.files[0]);
      if (txInput.files[0]) fd.append('transactions', txInput.files[0]);
      return fd;
    }

    $('#btnValidate').addEventListener('click', async () => {
      try{
        setStatus('Validating…');
        const res = await fetch('/api/validate', { method:'POST', body: getFormData() });
        const data = await res.json();
        if(!res.ok){ setStatus(data); return; }
        setStatus(data);
      }catch(e){ setStatus(String(e)); }
    });

    $('#btnGenerate').addEventListener('click', async () => {
      try{
        setStatus('Generating…');
        const res = await fetch('/upload', { method:'POST', body: getFormData() });
        const data = await res.json();
        if(!res.ok){ setStatus(data); return; }
        setStatus('Generated.');
        const html = [
          'Risk summary:',
          JSON.stringify(data.risk, null, 2),
          '',
          `Verify link: ${data.verify_url}`,
          `Download ZIP: ${data.download_url}`
        ].join('\n');
        setResult(html);
      }catch(e){ setStatus(String(e)); }
    });
  </script>
</body>
</html>
