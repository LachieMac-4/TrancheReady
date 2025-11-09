<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TrancheReady — App</title>
<link rel="icon" href="/public/favicon.ico" />
<style>
  :root{
    --ink:#E6EDFF; --muted:#95A7D0; --bg:#0A1630; --panel:#0B1733; --line:#213058;
    --brand1:#2455FF; --brand2:#7AA3FF; --radius:14px
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:radial-gradient(80% 120% at 20% 0%,#0E1F54 0%,#0A1630 45%,#0A1630 100%);color:var(--ink);}
  .nav{position:sticky;top:0;backdrop-filter:blur(10px);background:rgba(10,22,48,.6);border-bottom:1px solid var(--line);z-index:2}
  .navin{max-width:1120px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;gap:16px}
  .brand{font-weight:700;letter-spacing:.2px}
  .wrap{max-width:1120px;margin:24px auto;padding:0 16px}
  .card{background:linear-gradient(180deg,var(--panel),#0A1530);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 18px 44px rgba(0,12,45,.35);padding:18px;margin-bottom:16px}
  h1,h2{margin:.3rem 0 .6rem}
  .muted{color:var(--muted)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .grid > .card{margin:0}
  label{display:block;margin:.4rem 0 .25rem}
  input[type=file]{display:block;width:100%;padding:10px;border:1px dashed var(--line);border-radius:12px;background:#0B1738;color:var(--ink)}
  .btn{display:inline-flex;align-items:center;gap:8px;border-radius:12px;padding:12px 16px;border:1px solid var(--line);background:linear-gradient(90deg,var(--brand1),var(--brand2));color:white;cursor:pointer;font-weight:600}
  .btn.secondary{background:#0B1733;border:1px solid var(--line);color:var(--ink)}
  pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;background:#0C1733;border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .ok{color:#7FFFD4}
  .err{color:#FF9AA2}
  @media (max-width:920px){ .grid{grid-template-columns:1fr} }
</style>
</head>
<body>
  <div class="nav"><div class="navin">
    <div class="brand">TrancheReady</div>
    <div style="margin-left:auto" class="row">
      <a class="btn secondary" href="/team">Team</a>
      <a class="btn secondary" href="/pricing">Upgrade/Billing</a>
    </div>
  </div></div>

  <div class="wrap">
    <div class="card">
      <h1>CSV in → Signed ZIP out</h1>
      <p class="muted">Upload <strong>Clients.csv</strong> and <strong>Transactions.csv</strong>. We’ll validate, score risks, create monitoring cases, and return a ZIP with a <em>signed</em> manifest and a printable HTML.</p>
      <div class="grid">
        <div class="card">
          <label>Clients.csv</label>
          <input id="clients" type="file" accept=".csv,text/csv" />
          <label>Transactions.csv</label>
          <input id="transactions" type="file" accept=".csv,text/csv" />
          <div class="row" style="margin-top:12px">
            <button id="btnValidate" class="btn">Validate</button>
            <button id="btnGenerate" class="btn secondary">Generate Evidence</button>
          </div>
          <div id="status" class="muted" style="margin-top:8px"></div>
        </div>
        <div class="card">
          <h2>Templates</h2>
          <div class="row">
            <a class="btn secondary" href="/api/templates?name=clients">Clients template</a>
            <a class="btn secondary" href="/api/templates?name=transactions">Transactions template</a>
          </div>
          <h2 style="margin-top:14px">Results</h2>
          <div id="results"><p class="muted">Run validate/generate to see details.</p></div>
        </div>
      </div>
    </div>
  </div>

<script>
function sel(id){return document.getElementById(id)}
async function postFiles(url){
  const c = sel('clients').files[0];
  const t = sel('transactions').files[0];
  if(!c || !t) throw new Error('Please choose both CSV files first.');
  const fd = new FormData();
  fd.append('clients', c);
  fd.append('transactions', t);
  const r = await fetch(url,{ method:'POST', body:fd });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||'Request failed');
  return j;
}
sel('btnValidate').onclick = async ()=>{
  sel('status').textContent = 'Validating...';
  sel('results').innerHTML = '';
  try{
    const j = await postFiles('/api/validate');
    sel('status').innerHTML = '<span class="ok">OK</span>';
    sel('results').innerHTML = '<pre>'+JSON.stringify(j,null,2)+'</pre>';
  }catch(e){
    sel('status').innerHTML = '<span class="err">'+e.message+'</span>';
  }
};
sel('btnGenerate').onclick = async ()=>{
  sel('status').textContent = 'Generating evidence...';
  sel('results').innerHTML = '';
  try{
    const j = await postFiles('/upload');
    const html = [
      '<div class="card"><div class="row">',
      '<a class="btn" href="'+j.verify_url+'">Open Verify Link</a>',
      '<a class="btn secondary" href="'+j.download_url+'">Download ZIP</a>',
      '</div><pre>'+JSON.stringify(j.risk,null,2)+'</pre></div>'
    ].join('');
    sel('results').innerHTML = html;
    sel('status').innerHTML = '<span class="ok">Done</span>';
  }catch(e){
    sel('status').innerHTML = '<span class="err">'+e.message+'</span>';
  }
};
</script>
</body>
</html>
