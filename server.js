// server.js — Simple Mode: one plan checkout → cookie → /app; sample data + verify/download
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import archiver from 'archiver';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { PassThrough } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const {
  PORT = 3000,
  APP_HOST = 'https://trancheready-hbv7.onrender.com',
  STRIPE_SECRET_KEY = '',
  STRIPE_PRICE_ID_STARTER = '',
  JWT_SECRET = 'change_me'
} = process.env;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "font-src": ["'self'","data:"],
      "img-src": ["'self'","data:"],
      "script-src": ["'self'"],
      "style-src": ["'self'","'unsafe-inline'"],
      "connect-src": ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(JWT_SECRET));

app.use('/site', express.static(path.join(__dirname, 'public/site'), { maxAge: '1h' }));
app.use('/templates', express.static(path.join(__dirname, 'public/templates'), { maxAge: '1h' }));

// session helpers
function signSession(payload, mins = 360) { return jwt.sign(payload, JWT_SECRET, { expiresIn: `${mins}m` }); }
function readSession(req) { const t = req.signedCookies?.tr_session; try { return t ? jwt.verify(t, JWT_SECRET) : null; } catch { return null; } }
function requirePaid(req, res, next){ const s = readSession(req); if(!s?.paid) return res.redirect('/pricing'); req.user = s; next(); }
app.use((req,res,next)=>{ res.locals.user = readSession(req); next(); });

// marketing aliases
app.get('/', (_req,res)=>res.redirect('/site/index.html'));
app.get('/features', (_req,res)=>res.redirect('/site/features.html'));
app.get('/pricing', (_req,res)=>res.redirect('/site/pricing.html'));
app.get('/faq', (_req,res)=>res.redirect('/site/faq.html'));

// checkout (single plan)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
    if (!STRIPE_PRICE_ID_STARTER) return res.status(400).json({ error: 'Missing price id' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID_STARTER, quantity: 1 }],
      success_url: `${APP_HOST}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_HOST}/pricing`,
      allow_promotion_codes: true,
      customer_creation: 'always',
      ui_mode: 'hosted'
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('checkout', e);
    res.status(500).json({ error: 'Checkout creation failed' });
  }
});

// return from checkout → set cookie → /app
app.get('/billing/return', async (req, res) => {
  try {
    if (!stripe) return res.redirect('/pricing');
    const { session_id } = req.query;
    if (!session_id) return res.redirect('/pricing');
    const s = await stripe.checkout.sessions.retrieve(session_id, { expand: ['customer','subscription'] });
    if (!s || s.status !== 'complete') return res.redirect('/pricing');

    const token = signSession({
      paid: true,
      plan: 'starter',
      stripe_customer: typeof s.customer === 'string' ? s.customer : s.customer?.id,
      stripe_subscription: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
      email: s.customer_details?.email || null,
      role: 'owner'
    });
    res.cookie('tr_session', token, { httpOnly:true, sameSite:'lax', secure:true, signed:true, maxAge: 1000*60*60*6 });
    res.redirect('/app');
  } catch (e) {
    console.error('billing/return', e);
    res.redirect('/pricing');
  }
});

// optional: simple portal button (manage billing)
app.post('/billing/portal', requirePaid, async (req, res) => {
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer,
      return_url: `${APP_HOST}/app`
    });
    res.json({ url: portal.url });
  } catch (e) {
    console.error('portal', e);
    res.status(500).json({ error: 'Portal start failed' });
  }
});

app.post('/logout', (req,res)=>{ res.clearCookie('tr_session', { httpOnly:true, sameSite:'lax', secure:true, signed:true }); res.redirect('/'); });

// account
app.get('/account', requirePaid, (req,res)=> res.render('account', { user: readSession(req) || {} }));
app.post('/account', requirePaid, (req,res)=>{
  const cur = readSession(req)||{};
  const next = { ...cur, name:req.body.name||'', company:req.body.company||'', abn:req.body.abn||'' };
  const token = signSession(next);
  res.cookie('tr_session', token, { httpOnly:true, sameSite:'lax', secure:true, signed:true, maxAge: 1000*60*60*6 });
  res.redirect('/account');
});

// app + csv flow
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.get('/app', requirePaid, (_req,res)=> res.render('app'));

const HR = new Set(['RU','CN','HK','AE','IN','IR']);
const idKeyFromRow = (row) => {
  const k = Object.keys(row).map(x=>x.toLowerCase());
  if (k.includes('client_id')) return 'client_id';
  if (k.includes('clientid')) return 'clientid';
  if (k.includes('id')) return 'id';
  return k[0];
};
const L = s => (s ?? '').toString().toLowerCase();
const U = s => (s ?? '').toString().toUpperCase();
const num = v => { const x = Number((v??'').toString().replace(/[,\s$AUD]/gi,'')); return Number.isFinite(x)?x:0; };
const dt  = v => { const d = new Date(v); return isNaN(d) ? null : d; };
const band = n => n>=30?'High':n>=15?'Medium':'Low';

function analyze(clientsRaw, txnsRaw){
  const clients = clientsRaw.map(o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k.toLowerCase(),v])));
  const txns = txnsRaw.map(o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k.toLowerCase(),v])));
  const idk = clients.length ? idKeyFromRow(clients[0]) : 'client_id';

  const byClient = new Map();
  for (const t of txns){ const id = t[idk] ?? t.client_id ?? t.clientid ?? t.id; if(!id) continue; (byClient.get(id) ?? byClient.set(id,[]).get(id)).push(t); }

  const scores=[], cases=[];
  for (const c of clients){
    const id = c[idk] ?? c.client_id ?? c.clientid ?? c.id ?? '';
    const all = (byClient.get(id)||[]);
    let s=0, reasons=[];
    const pep = L(c.pep)==='true'||L(c.is_pep)==='true';
    const sanc= L(c.sanctions)==='true'||L(c.on_sanctions)==='true';
    const res = U(c.country||c.residency);
    const kyc = dt(c.kyc_last_updated||c.kyc_date||c.kyc_last_reviewed);
    if(pep){ s+=25; reasons.push('PEP'); }
    if(sanc){ s+=25; reasons.push('Sanctions'); }
    if(res && HR.has(res)){ s+=10; reasons.push(`Residency: ${res}`); }
    if(kyc && (Date.now()-kyc)/ (1000*60*60*24*30) > 18){ s+=8; reasons.push('Stale KYC (>18 months)'); }

    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-18);
    const recent = all.filter(t=>{ const d=dt(t.date||t.posted_at||t.txn_date); return d && d>=cutoff; });

    // structuring
    const cash = recent.filter(t=>{
      const type=L(t.type||t.txn_type), method=L(t.method||t.channel);
      const amt=num(t.amount||t.aud_amount||t.amount_aud||t.amt);
      return (type.includes('cash')||method.includes('cash')) && amt>=9600 && amt<10000;
    }).map(t=>dt(t.date||t.posted_at||t.txn_date)).sort((a,b)=>a-b);
    let structured=false;
    for(let i=0;i<cash.length;i++){ let count=1; for(let j=i+1;j<cash.length;j++){ if((cash[j]-cash[i])/(86400000)<=7) count++; else break; } if(count>=4){ structured=true; break; } }
    if(structured){ s+=20; reasons.push('Structuring (cash 9.6–9.9k, 7 days)'); cases.push({client_id:id,type:'Structuring',severity:'High'}); }

    // corridors
    const intl = recent.filter(t=>{
      const to=U(t.to_country||t.country||t.beneficiary_country);
      const dir=L(t.direction); const isIntl=L(t.international||t.is_international)==='true';
      return (dir==='out'||isIntl||to) && HR.has(to);
    });
    if(intl.length>=2 && intl.some(t=>num(t.amount||t.aud_amount)>=20000)){
      s+=12; reasons.push('High-risk corridor (≥2, ≥1 ≥$20k)'); cases.push({client_id:id,type:'High-risk corridor',severity:'Medium'});
    }

    // large domestic
    if(recent.some(t=>L(t.international||t.is_international)!=='true' && num(t.amount||t.aud_amount)>=100000)){
      s+=10; reasons.push('Large domestic transfer ≥ $100k'); cases.push({client_id:id,type:'Large domestic transfer',severity:'Medium'});
    }
    scores.push({ client_id:id, band:band(s), score: s, reasons });
  }

  const counts={ total:scores.length, high:scores.filter(x=>x.band==='High').length, medium:scores.filter(x=>x.band==='Medium').length, low:scores.filter(x=>x.band==='Low').length };
  return { scores, cases, counts };
}

async function buildPack({clients, txns}){
  const { scores, cases, counts } = analyze(clients, txns);
  const buildId = nanoid(10); const token = nanoid(24);
  const files = {
    'clients.json': Buffer.from(JSON.stringify(clients,null,2)),
    'transactions.json': Buffer.from(JSON.stringify(txns,null,2)),
    'cases.json': Buffer.from(JSON.stringify(cases,null,2)),
    'program.html': Buffer.from(`<!doctype html><meta charset="utf-8"><title>Program</title><style>body{font-family:Inter,system-ui,Arial;padding:20px;line-height:1.45}</style><h1>TrancheReady Evidence</h1><p><b>Build:</b> ${buildId}</p><p><b>Counts:</b> H ${counts.high} / M ${counts.medium} / L ${counts.low} (Total ${counts.total})</p><h3>Top Scores (sample)</h3><pre>${JSON.stringify(scores.slice(0,10),null,2)}</pre>`)}
  };
  const manifest={ build_id:buildId, token, created_at:new Date().toISOString(), files:{} };
  for(const [name,buf] of Object.entries(files)){
    manifest.files[name]={ sha256:crypto.createHash('sha256').update(buf).digest('hex'), bytes:buf.length };
  }
  files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2));
  const zipName=`trancheready_${buildId}.zip`;
  const zipBuf=await zipNamedBuffers(files);
  return { token, zipName, zipBuf, manifest, scores, cases, counts };
}

const verifyStore=new Map();

app.post('/upload', requirePaid, multer({storage:multer.memoryStorage(), limits:{fileSize:25*1024*1024}}).fields([{name:'clients'},{name:'transactions'}]), async (req,res)=>{
  try{
    const c=req.files?.clients?.[0]?.buffer, t=req.files?.transactions?.[0]?.buffer;
    if(!c||!t) return res.status(400).json({ error:'Both Clients.csv and Transactions.csv are required.'});
    const clients=csvParse(c.toString('utf8'),{columns:true,skip_empty_lines:true});
    const txns=csvParse(t.toString('utf8'),{columns:true,skip_empty_lines:true});
    const pack=await buildPack({clients, txns});
    verifyStore.set(pack.token, { zipName:pack.zipName, zipBuf:pack.zipBuf, manifest:pack.manifest });
    res.json({ ok:true, counts:pack.counts, top:pack.scores.slice(0,5), cases:pack.cases.slice(0,20), verify_url:`${APP_HOST}/verify/${pack.token}`, download_url:`${APP_HOST}/download/${pack.token}` });
  }catch(e){ console.error('upload',e); res.status(500).json({ error:'Failed to build evidence pack' }); }
});

app.post('/api/sample-pack', requirePaid, async (_req,res)=>{
  try{
    const clients=[
      { ClientID:'C-1001', Name:'Acacia Legal', PEP:'false', Sanctions:'false', Country:'AU', KYC_Last_Updated:'2024-02-10' },
      { ClientID:'C-1002', Name:'Harbor Group', PEP:'true',  Sanctions:'false', Country:'AU', KYC_Last_Updated:'2023-01-15' },
      { ClientID:'C-1003', Name:'Blue Kangaroo', PEP:'false', Sanctions:'false', Country:'HK', KYC_Last_Updated:'2022-06-01' },
      { ClientID:'C-1004', Name:'Southern Realty', PEP:'false', Sanctions:'false', Country:'AU', KYC_Last_Updated:'2024-10-01' }
    ];
    const txns=[
      { ClientID:'C-1004', Date:'2025-03-01', Type:'cash deposit', Amount:'9,800', Direction:'in', International:'false' },
      { ClientID:'C-1004', Date:'2025-03-02', Type:'cash deposit', Amount:'9,900', Direction:'in', International:'false' },
      { ClientID:'C-1004', Date:'2025-03-04', Type:'cash deposit', Amount:'9,960', Direction:'in', International:'false' },
      { ClientID:'C-1004', Date:'2025-03-05', Type:'cash deposit', Amount:'9,700', Direction:'in', International:'false' },
      { ClientID:'C-1003', Date:'2025-07-01', Type:'wire', Amount:'21,000', Direction:'out', Is_International:'true', To_Country:'HK' },
      { ClientID:'C-1003', Date:'2025-07-22', Type:'wire', Amount:'5,500',  Direction:'out', Is_International:'true', To_Country:'HK' },
      { ClientID:'C-1001', Date:'2025-06-10', Type:'wire', Amount:'120,000', Direction:'out', Is_International:'false' }
    ];
    const pack=await buildPack({clients, txns});
    verifyStore.set(pack.token, { zipName:pack.zipName, zipBuf:pack.zipBuf, manifest:pack.manifest });
    res.json({ ok:true, counts:pack.counts, top:pack.scores.slice(0,5), cases:pack.cases.slice(0,20), verify_url:`${APP_HOST}/verify/${pack.token}`, download_url:`${APP_HOST}/download/${pack.token}` });
  }catch(e){ console.error('sample-pack',e); res.status(500).json({ error:'Failed to build sample pack' }); }
});

app.get('/verify/:token', (req,res)=>{ const r=verifyStore.get(req.params.token); if(!r) return res.status(404).render('error',{title:'Not found',message:'Invalid or expired token.'}); res.render('verify',{ manifest:r.manifest, build_id:r.manifest.build_id }); });
app.get('/download/:token', (req,res)=>{ const r=verifyStore.get(req.params.token); if(!r) return res.status(404).send('Invalid or expired token'); res.setHeader('Content-Type','application/zip'); res.setHeader('Content-Disposition',`attachment; filename="${r.zipName}"`); res.end(r.zipBuf); });

function zipNamedBuffers(namedBuffers){
  return new Promise((resolve,reject)=>{
    const out=new PassThrough(); const chunks=[];
    out.on('data',d=>chunks.push(d)); out.on('end',()=>resolve(Buffer.concat(chunks)));
    const archive=archiver('zip',{ zlib:{ level:9 }});
    archive.on('error',reject); archive.pipe(out);
    for(const [name,buf] of Object.entries(namedBuffers)){ archive.append(buf,{name}); }
    archive.finalize();
  });
}

app.get('/healthz', (_req,res)=>res.json({ ok:true, time:new Date().toISOString() }));
app.listen(PORT, ()=>console.log(`TrancheReady on :${PORT}`));
