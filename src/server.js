'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { db, now, CATEGORIES, ROOT } = require('./db');
const { extract } = require('./extract');

const PORT = Number(process.env.PORT || 4477);
const HOST = process.env.HOST || '127.0.0.1';
const SHOTS = path.join(ROOT, 'shots');
const THUMBS = path.join(SHOTS, 'thumbs');
const INBOX = path.join(ROOT, 'inbox');
const PUBLIC = path.join(ROOT, 'public');
const CONCURRENCY = 2;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.heic', '.webp', '.gif', '.tiff', '.bmp', '.pdf']);

for (const d of [SHOTS, THUMBS, INBOX]) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ queue */

const queue = [];
let active = 0;

function enqueue(imageId) {
  queue.push(imageId);
  pump();
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const id = queue.shift();
    active++;
    processImage(id)
      .catch((e) => console.error('[worker]', e.message))
      .finally(() => { active--; pump(); });
  }
}

async function processImage(imageId) {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
  if (!img) return;
  db.prepare('UPDATE images SET status = ?, updated_at = ? WHERE id = ?').run('working', now(), imageId);
  try {
    const result = await extract(img.path);
    const ts = now();
    if (!result.isExpense || result.expenses.length === 0) {
      db.prepare(`UPDATE images SET status='ignored', error=?, raw_text=?, source_app=?, updated_at=? WHERE id=?`)
        .run(result.reason || 'No transaction found in this image', result.rawText, result.sourceApp, ts, imageId);
      console.log(`[skip] #${imageId} ${img.filename} - ${result.reason || 'no transaction'}`);
      return;
    }
    const ins = db.prepare(`INSERT INTO expenses
      (image_id, merchant, amount, currency, spent_at, spent_time, category, payment_method,
       account, txn_ref, note, direction, confidence, needs_review, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const e of result.expenses) {
      ins.run(imageId, e.merchant, e.amount, e.currency, e.spent_at, e.spent_time, e.category,
        e.payment_method, e.account, e.txn_ref, e.note, e.direction, e.confidence, e.needs_review, ts, ts);
    }
    db.prepare(`UPDATE images SET status='done', error=NULL, raw_text=?, source_app=?, updated_at=? WHERE id=?`)
      .run(result.rawText, result.sourceApp, ts, imageId);
    console.log(`[ok]   #${imageId} ${img.filename} -> ${result.expenses.length} expense(s)`);
  } catch (err) {
    db.prepare(`UPDATE images SET status='failed', error=?, updated_at=? WHERE id=?`)
      .run(String(err.message).slice(0, 500), now(), imageId);
    console.error(`[fail] #${imageId} ${img.filename} - ${err.message}`);
  }
}

/* ----------------------------------------------------------------- ingest */

function makeThumb(src, dest) {
  return new Promise((resolve) => {
    execFile('sips', ['-Z', '600', src, '-s', 'format', 'jpeg', '--out', dest],
      { timeout: 20_000 }, (err) => resolve(!err));
  });
}

async function ingestBuffer(buf, filename) {
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = db.prepare('SELECT * FROM images WHERE sha256 = ?').get(sha);
  if (existing) return { duplicate: true, image: existing };

  let ext = path.extname(filename || '').toLowerCase();
  if (!IMAGE_EXT.has(ext)) ext = '.png';
  const dest = path.join(SHOTS, sha + ext);
  await fsp.writeFile(dest, buf);

  const thumbPath = path.join(THUMBS, sha + '.jpg');
  const ok = await makeThumb(dest, thumbPath);

  const ts = now();
  const info = db.prepare(
    `INSERT INTO images (sha256, filename, path, thumb, status, created_at, updated_at)
     VALUES (?,?,?,?,'pending',?,?)`
  ).run(sha, filename || path.basename(dest), dest, ok ? thumbPath : dest, ts, ts);

  const id = Number(info.lastInsertRowid);
  enqueue(id);
  return { duplicate: false, image: db.prepare('SELECT * FROM images WHERE id = ?').get(id) };
}

/* ---------------------------------------------------------------- watcher */

const settling = new Map();

async function ingestFromInbox(file) {
  const full = path.join(INBOX, file);
  try {
    const buf = await fsp.readFile(full);
    const res = await ingestBuffer(buf, file);
    await fsp.unlink(full).catch(() => {});
    console.log(res.duplicate ? `[inbox] ${file} - already logged, removed` : `[inbox] ${file} - queued`);
  } catch (e) {
    console.error(`[inbox] ${file} - ${e.message}`);
  }
}

function watchInbox() {
  const consider = (file) => {
    if (!file || file.startsWith('.')) return;
    if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) return;
    clearTimeout(settling.get(file));
    settling.set(file, setTimeout(async () => {
      settling.delete(file);
      const full = path.join(INBOX, file);
      // wait until the file stops growing (screenshots land in two writes)
      let last = -1;
      for (let i = 0; i < 25; i++) {
        let size;
        try { size = (await fsp.stat(full)).size; } catch { return; }
        if (size > 0 && size === last) break;
        last = size;
        await new Promise((r) => setTimeout(r, 200));
      }
      ingestFromInbox(file);
    }, 400));
  };
  fs.watch(INBOX, (_evt, file) => consider(file));
  // catch anything already sitting there at boot
  fs.readdirSync(INBOX).forEach(consider);
  console.log(`[watch] drop screenshots into ${INBOX}`);
}

/* -------------------------------------------------------------- queries */

const EXPENSE_COLS = `e.*, i.thumb AS thumb, i.filename AS filename, i.source_app AS source_app, i.id AS img_id`;

function listExpenses({ month, q, category, review }) {
  const where = ['e.deleted = 0'];
  const args = [];
  if (month) { where.push(`substr(e.spent_at,1,7) = ?`); args.push(month); }
  if (category) { where.push(`e.category = ?`); args.push(category); }
  if (review) where.push(`e.needs_review = 1`);
  if (q) {
    where.push(`(e.merchant LIKE ? OR e.note LIKE ? OR e.category LIKE ? OR e.account LIKE ?)`);
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  return db.prepare(
    `SELECT ${EXPENSE_COLS} FROM expenses e LEFT JOIN images i ON i.id = e.image_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.spent_at DESC, COALESCE(e.spent_time,'00:00') DESC, e.id DESC`
  ).all(...args);
}

function summary(month) {
  const scope = month ? `AND substr(spent_at,1,7) = ?` : '';
  const a = month ? [month] : [];

  // Amounts in different currencies must never be added together. Pick the
  // currency the month is mostly denominated in; report the rest separately.
  const byCurrency = db.prepare(
    `SELECT currency, SUM(amount) total, COUNT(*) n FROM expenses
     WHERE deleted=0 AND direction='debit' ${scope}
     GROUP BY currency ORDER BY n DESC, total DESC`
  ).all(...a);
  const currency = byCurrency[0]?.currency || 'INR';
  const others = byCurrency.slice(1);

  const args = [...a, currency];
  const one = (sql) => db.prepare(sql).get(...args) || {};
  const many = (sql) => db.prepare(sql).all(...args);
  const cur = `AND currency = ?`;

  const spend = one(`SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM expenses
                     WHERE deleted=0 AND direction='debit' ${scope} ${cur}`);
  const credit = one(`SELECT COALESCE(SUM(amount),0) t FROM expenses
                      WHERE deleted=0 AND direction='credit' ${scope} ${cur}`);
  const byCategory = many(`SELECT category, SUM(amount) total, COUNT(*) n FROM expenses
                           WHERE deleted=0 AND direction='debit' ${scope} ${cur}
                           GROUP BY category ORDER BY total DESC`);
  const byDay = many(`SELECT spent_at day, SUM(amount) total FROM expenses
                      WHERE deleted=0 AND direction='debit' ${scope} ${cur}
                      GROUP BY spent_at ORDER BY day`);
  const byMerchant = many(`SELECT merchant, SUM(amount) total, COUNT(*) n FROM expenses
                           WHERE deleted=0 AND direction='debit' ${scope} ${cur}
                           GROUP BY merchant ORDER BY total DESC LIMIT 8`);

  const reviewCount = db.prepare(
    `SELECT COUNT(*) n FROM expenses WHERE deleted=0 AND needs_review=1`).get().n;

  return {
    total: spend.t, count: spend.n, credits: credit.t,
    perDay: byDay.length ? spend.t / byDay.length : 0,
    activeDays: byDay.length,
    byCategory, byDay, byMerchant, currency, others, reviewCount
  };
}

function months() {
  return db.prepare(
    `SELECT DISTINCT substr(spent_at,1,7) m FROM expenses WHERE deleted=0 ORDER BY m DESC`
  ).all().map((r) => r.m);
}

function pipeline() {
  const rows = db.prepare(
    `SELECT id, filename, status, error, thumb, created_at FROM images
     WHERE status IN ('pending','working','failed','ignored')
     ORDER BY id DESC LIMIT 40`
  ).all();
  return {
    items: rows,
    working: rows.filter((r) => r.status === 'working').length,
    pending: rows.filter((r) => r.status === 'pending').length
  };
}

/* -------------------------------------------------------------- http api */

const send = (res, code, body, type = 'application/json') => {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
};

function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.heic': 'image/heic', '.pdf': 'application/pdf', '.tiff': 'image/tiff', '.bmp': 'image/bmp' };

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

const EDITABLE = ['merchant', 'amount', 'currency', 'spent_at', 'spent_time', 'category',
  'payment_method', 'account', 'txn_ref', 'note', 'direction', 'needs_review'];

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    /* ---- static ---- */
    if (req.method === 'GET' && (p === '/' || p === '/index.html'))
      return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (req.method === 'GET' && /^\/(app\.js|style\.css)$/.test(p))
      return serveFile(res, path.join(PUBLIC, p.slice(1)));

    /* ---- images ---- */
    let m = p.match(/^\/img\/(\d+)\/(thumb|full)$/);
    if (req.method === 'GET' && m) {
      const img = db.prepare('SELECT path, thumb FROM images WHERE id = ?').get(Number(m[1]));
      if (!img) return send(res, 404, { error: 'not found' });
      return serveFile(res, m[2] === 'thumb' ? (img.thumb || img.path) : img.path);
    }

    /* ---- state ---- */
    if (req.method === 'GET' && p === '/api/state') {
      const month = url.searchParams.get('month') || null;
      return send(res, 200, {
        expenses: listExpenses({
          month,
          q: url.searchParams.get('q') || '',
          category: url.searchParams.get('category') || '',
          review: url.searchParams.get('review') === '1'
        }),
        summary: summary(month),
        months: months(),
        categories: CATEGORIES,
        pipeline: pipeline(),
        busy: active + queue.length
      });
    }

    /* ---- upload ---- */
    if (req.method === 'POST' && p === '/api/upload') {
      const body = await readBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      const out = [];
      for (const f of files) {
        if (!f || !f.data) continue;
        const buf = Buffer.from(String(f.data).replace(/^data:[^,]+,/, ''), 'base64');
        if (!buf.length) continue;
        const r = await ingestBuffer(buf, f.name || 'screenshot.png');
        out.push({ name: f.name, duplicate: r.duplicate, id: r.image.id });
      }
      return send(res, 200, { accepted: out.length, results: out });
    }

    /* ---- expense CRUD ---- */
    m = p.match(/^\/api\/expenses\/(\d+)$/);
    if (m && (req.method === 'PATCH' || req.method === 'PUT')) {
      const id = Number(m[1]);
      const body = await readBody(req);
      const sets = [], args = [];
      for (const k of EDITABLE) {
        if (!(k in body)) continue;
        let v = body[k];
        if (k === 'amount') v = Math.abs(parseFloat(v) || 0);
        if (k === 'needs_review') v = v ? 1 : 0;
        if (k === 'direction') v = v === 'credit' ? 'credit' : 'debit';
        if (v === '' && k !== 'merchant') v = null;
        sets.push(`${k} = ?`); args.push(v);
      }
      if (!sets.length) return send(res, 400, { error: 'nothing to update' });
      sets.push('edited = 1', 'updated_at = ?'); args.push(now(), id);
      db.prepare(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      return send(res, 200, { ok: true, expense: db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) });
    }
    if (m && req.method === 'DELETE') {
      db.prepare('UPDATE expenses SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), Number(m[1]));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/expenses') {
      const b = await readBody(req);
      const ts = now();
      const info = db.prepare(`INSERT INTO expenses
        (merchant, amount, currency, spent_at, spent_time, category, payment_method, note,
         direction, confidence, needs_review, edited, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,1,0,1,?,?)`).run(
        String(b.merchant || 'Unknown').slice(0, 120),
        Math.abs(parseFloat(b.amount) || 0),
        String(b.currency || 'INR').toUpperCase().slice(0, 3),
        /^\d{4}-\d{2}-\d{2}$/.test(b.spent_at || '') ? b.spent_at : new Date().toISOString().slice(0, 10),
        /^\d{2}:\d{2}$/.test(b.spent_time || '') ? b.spent_time : null,
        CATEGORIES.includes(b.category) ? b.category : 'Other',
        b.payment_method || null, b.note || null,
        b.direction === 'credit' ? 'credit' : 'debit', ts, ts);
      return send(res, 200, { ok: true, id: Number(info.lastInsertRowid) });
    }

    /* ---- image actions ---- */
    m = p.match(/^\/api\/images\/(\d+)\/retry$/);
    if (req.method === 'POST' && m) {
      const id = Number(m[1]);
      db.prepare(`UPDATE images SET status='pending', error=NULL, updated_at=? WHERE id=?`).run(now(), id);
      db.prepare('UPDATE expenses SET deleted = 1 WHERE image_id = ?').run(id);
      enqueue(id);
      return send(res, 200, { ok: true });
    }
    m = p.match(/^\/api\/images\/(\d+)$/);
    if (req.method === 'DELETE' && m) {
      const id = Number(m[1]);
      const img = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
      db.prepare('DELETE FROM images WHERE id = ?').run(id);
      if (img) { fs.rm(img.path, () => {}); if (img.thumb) fs.rm(img.thumb, () => {}); }
      return send(res, 200, { ok: true });
    }

    /* ---- export ---- */
    if (req.method === 'GET' && p === '/api/export.csv') {
      const rows = listExpenses({ month: url.searchParams.get('month') || null, q: '', category: '', review: false });
      const head = ['date', 'time', 'merchant', 'amount', 'currency', 'direction', 'category',
        'payment_method', 'account', 'txn_ref', 'note', 'confidence', 'source_file'];
      const lines = [head.join(',')];
      for (const r of rows) {
        lines.push([r.spent_at, r.spent_time || '', r.merchant, r.amount.toFixed(2), r.currency,
          r.direction, r.category, r.payment_method || '', r.account || '', r.txn_ref || '',
          r.note || '', r.confidence.toFixed(2), r.filename || ''].map(csvEscape).join(','));
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="expenses-${url.searchParams.get('month') || 'all'}.csv"`
      });
      return res.end(lines.join('\n'));
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[http]', err);
    return send(res, 500, { error: err.message });
  }
});

// requeue anything left mid-flight from a previous run
const stale = db.prepare(`SELECT id FROM images WHERE status IN ('pending','working')`).all();
stale.forEach((r) => enqueue(r.id));

server.listen(PORT, HOST, () => {
  console.log(`\n  Expense Tracker  ->  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    const nets = require('node:os').networkInterfaces();
    for (const list of Object.values(nets))
      for (const n of list)
        if (n.family === 'IPv4' && !n.internal)
          console.log(`  From your phone   ->  http://${n.address}:${PORT}`);
  }
  console.log(`  Inbox folder     ->  ${INBOX}`);
  if (stale.length) console.log(`  Resuming ${stale.length} unfinished screenshot(s)`);
  watchInbox();
  console.log('');
});

module.exports = { ingestBuffer };
