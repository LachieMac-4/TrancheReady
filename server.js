// server.js — payments → access → profiles, plus your existing CSV → ZIP flow
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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

// ────────────────────────────────────────────────────────────────────────────
// Config & setup
// ────────────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const {
  PORT = 3000,
  APP_HOST = 'https://trancheready.com',
  // Stripe
  STRIPE_SECRET_KEY = '',
  STRIPE_PRICE_ID_STARTER = '',
  STRIPE_PRICE_ID_TEAM = '',
  STRIPE_WEBHOOK_SECRET = '', // optional (not used in this minimal setup)
  // Security
  JWT_SECRET = 'change_me_in_render'
} = process.env;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Helmet (CSP kept strict; loosen img-src if you host logos elsewhere)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "font-src": ["'self'", "data:"],
      "img-src": ["'self'", "data:"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // allow inline styles for EJS/basic CSS vars
      "connect-src": ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(JWT_SECRET));

// Static site
app.use('/site', express.static(path.join(__dirname, 'public/site'), { maxAge: '1h' }));
app.use('/templates', express.static(path.join(__dirname, 'public/templates'), { maxAge: '1h' }));

// ────────────────────────────────────────────────────────────────────────────
/** UTIL: issue signed JWT session (no DB). */
function signSession(payload, ttlMins = 6 * 60) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${ttlMins}m` });
}
/** UTIL: read session */
function readSession(req) {
  const token = req.signedCookies?.tr_session;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}
/** MW: require paid access */
function requirePaid(req, res, next) {
  const sess = readSession(req);
  if (!sess?.paid) {
    return res.redirect('/pricing'); // send to paywall
  }
  req.user = sess;
  next();
}
/** MW: attach user if any (for header conditionals) */
function attachUser(req, res, next) {
  const sess = readSession(req);
  res.locals.user = sess || null;
  next();
}
app.use(attachUser);

// ────────────────────────────────────────────────────────────────────────────
// MARKETING ROUTES (static already served under /site/*)
// Friendly aliases for top-level nav
app.get('/', (req, res) => res.redirect('/site/index.html'));
app.get('/features', (req, res) => res.redirect('/site/features.html'));
app.get('/pricing', (req, res) => res.redirect('/site/pricing.html'));
app.get('/faq', (req, res) => res.redirect('/site/faq.html'));

// ────────────────────────────────────────────────────────────────────────────
// STRIPE: create Checkout session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
    const { plan = 'starter' } = req.body;
    const priceId = plan === 'team' ? STRIPE_PRICE_ID_TEAM : STRIPE_PRICE_ID_STARTER;
    if (!priceId) return res.status(400).json({ error: 'Missing Stripe price id' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_HOST}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_HOST}/pricing`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_creation: 'always',
      ui_mode: 'hosted',
      // Optional: collect ABN or company as custom fields (visible in Stripe)
      custom_fields: [
        { key: 'company', label: { type: 'custom', custom: 'Company' }, type: 'text', optional: true },
        { key: 'abn', label: { type: 'custom', custom: 'ABN' }, type: 'text', optional: true }
      ]
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('checkout error', err);
    return res.status(500).json({ error: 'Checkout creation failed' });
  }
});

// STRIPE: return from Checkout → set cookie → go to app
app.get('/billing/return', async (req, res) => {
  try {
    if (!stripe) return res.redirect('/pricing');
    const { session_id } = req.query;
    if (!session_id) return res.redirect('/pricing');
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['customer', 'subscription'] });
    if (!session || session.status !== 'complete') return res.redirect('/pricing');

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    const plan = session?.metadata?.plan || 'starter';

    // mark paid (minimal check); for full rigor, also verify subscription status == 'active'
    const token = signSession({
      paid: true,
      plan,
      stripe_customer: customerId,
      stripe_subscription: subId,
      email: session.customer_details?.email || null,
      role: 'owner'
    });

    res.cookie('tr_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      signed: true,
      maxAge: 1000 * 60 * 60 * 6 // 6 hours; users can rehit /billing/return from portal if extended
    });

    return res.redirect('/app');
  } catch (e) {
    console.error('billing/return error', e);
    return res.redirect('/pricing');
  }
});

// STRIPE: Customer Portal (manage/cancel)
app.post('/billing/portal', requirePaid, async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
    const { stripe_customer } = req.user;
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripe_customer,
      return_url: `${APP_HOST}/app`
    });
    return res.json({ url: portal.url });
  } catch (e) {
    console.error('portal error', e);
    return res.status(500).json({ error: 'Failed to start portal' });
  }
});

// Logout
app.post('/logout', (req, res) => {
  res.clearCookie('tr_session', { httpOnly: true, sameSite: 'lax', secure: true, signed: true });
  res.redirect('/');
});

// ────────────────────────────────────────────────────────────────────────────
// ACCOUNT: basic profile editor (stored in session cookie)
app.get('/account', requirePaid, (req, res) => {
  const user = readSession(req) || {};
  res.render('account', { user });
});
app.post('/account', requirePaid, (req, res) => {
  const current = readSession(req) || {};
  const next = {
    ...current,
    name: req.body.name || '',
    company: req.body.company || '',
    abn: req.body.abn || '',
  };
  const token = signSession(next);
  res.cookie('tr_session', token, {
    httpOnly: true, sameSite: 'lax', secure: true, signed: true, maxAge: 1000 * 60 * 60 * 6
  });
  res.redirect('/account');
});

// ────────────────────────────────────────────────────────────────────────────
// APP (gated): your existing CSV → ZIP → verify flow
// Memory upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Home app
app.get('/app', requirePaid, (req, res) => {
  res.render('app'); // your existing app.ejs (styled)
});

// Validate CSVs quickly (re-usable for UX)
app.post('/api/validate', requirePaid, upload.fields([{ name: 'clients' }, { name: 'transactions' }]), (req, res) => {
  try {
    const clientsBuf = req.files?.clients?.[0]?.buffer;
    const txBuf = req.files?.transactions?.[0]?.buffer;
    if (!clientsBuf || !txBuf) return res.status(400).json({ error: 'Both Clients.csv and Transactions.csv are required.' });

    const clients = csvParse(clientsBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
    const txns = csvParse(txBuf.toString('utf8'), { columns: true, skip_empty_lines: true });

    return res.json({
      ok: true,
      clients: { count: clients.length, fields: Object.keys(clients[0] || {}) },
      transactions: { count: txns.length, fields: Object.keys(txns[0] || {}) }
    });
  } catch (e) {
    console.error('validate error', e);
    return res.status(400).json({ error: 'CSV parse failed' });
  }
});

// Upload → score → build pack
// Minimal scoring placeholder (plug your real rules engine here)
function scoreClients(clients, txns) {
  // simple illustrative: everyone Low unless PEP/sanctions flag
  return clients.map(c => {
    const pep = String(c.PEP || c.pep || '').toLowerCase() === 'true';
    const sanc = String(c.Sanctions || c.sanctions || '').toLowerCase() === 'true';
    const score = pep || sanc ? 35 : 10;
    const band = score >= 30 ? 'High' : score >= 15 ? 'Medium' : 'Low';
    const reasons = [];
    if (pep) reasons.push('PEP');
    if (sanc) reasons.push('Sanctions');
    if (!reasons.length) reasons.push('No high-risk profile flags detected');
    return { client_id: c.ClientID || c.client_id || c.ClientId || '', band, score, reasons };
  });
}

// ephemeral in-memory store for verify tokens for the life of the process
const verifyStore = new Map();

app.post('/upload', requirePaid, upload.fields([{ name: 'clients' }, { name: 'transactions' }]), async (req, res) => {
  try {
    const clientsBuf = req.files?.clients?.[0]?.buffer;
    const txBuf = req.files?.transactions?.[0]?.buffer;
    if (!clientsBuf || !txBuf) return res.status(400).json({ error: 'Both Clients.csv and Transactions.csv are required.' });

    const clients = csvParse(clientsBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
    const txns = csvParse(txBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
    const scores = scoreClients(clients, txns);

    const cases = []; // TODO: add structuring / corridor / large domestic detection like your spec

    // Build files
    const buildId = nanoid(10);
    const token = nanoid(24);

    const files = {
      'clients.json': Buffer.from(JSON.stringify(clients, null, 2)),
      'transactions.json': Buffer.from(JSON.stringify(txns, null, 2)),
      'cases.json': Buffer.from(JSON.stringify(cases, null, 2)),
      'program.html': Buffer.from(`<!doctype html><meta charset="utf-8"><title>Program</title><h1>Evidence Summary</h1>
        <p>Build: ${buildId}</p><pre>${JSON.stringify(scores.slice(0, 10), null, 2)}...</pre>`)
    };

    // manifest with hashes
    const manifest = {
      build_id: buildId,
      token,
      created_at: new Date().toISOString(),
      files: {}
    };
    for (const [name, buf] of Object.entries(files)) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      manifest.files[name] = { sha256: hash, bytes: buf.length };
    }
    files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2));

    // zip in-memory
    const zipName = `trancheready_${buildId}.zip`;
    const zipBuf = await zipNamedBuffers(files);

    // store in memory for download/verify
    verifyStore.set(token, { zipName, zipBuf, manifest });

    return res.json({
      ok: true,
      risk: {
        counts: { high: scores.filter(s => s.band === 'High').length, total: scores.length }
      },
      verify_url: `${APP_HOST}/verify/${token}`,
      download_url: `${APP_HOST}/download/${token}`
    });
  } catch (e) {
    console.error('upload error', e);
    return res.status(500).json({ error: 'Failed to build evidence pack' });
  }
});

// Verify + Download
app.get('/verify/:token', (req, res) => {
  const rec = verifyStore.get(req.params.token);
  if (!rec) return res.status(404).render('error', { title: 'Not found', message: 'Invalid or expired token.' });
  return res.render('verify', { manifest: rec.manifest, build_id: rec.manifest.build_id });
});
app.get('/download/:token', (req, res) => {
  const rec = verifyStore.get(req.params.token);
  if (!rec) return res.status(404).send('Invalid or expired token');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${rec.zipName}"`);
  return res.end(rec.zipBuf);
});

// ZIP helper
function zipNamedBuffers(namedBuffers) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.on('data', d => chunks.push(d));
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    archive.pipe(new (require('stream').PassThrough)()); // not used; we'll collect via 'data'
    for (const [name, buf] of Object.entries(namedBuffers)) {
      archive.append(buf, { name });
    }
    archive.finalize();

    // collect data via internal stream (use archive.on('data'))
    const origEmit = archive.emit;
    archive.emit = function (ev, ...args) {
      if (ev === 'data') chunks.push(args[0]);
      return origEmit.call(this, ev, ...args);
    };
  });
}

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Start
app.listen(PORT, () => {
  console.log(`TrancheReady listening on :${PORT}`);
});
