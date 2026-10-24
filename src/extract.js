'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');
const { CATEGORIES } = require('./db');

const ROOT = path.join(__dirname, '..');
const OCR_BIN = path.join(ROOT, 'bin', 'vision-ocr');
const CLAUDE_TIMEOUT_MS = 180_000;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

/** Local, offline OCR via the macOS Vision framework. Never throws. */
async function ocr(imagePath) {
  try {
    const { stdout } = await run(OCR_BIN, [imagePath], { timeout: 30_000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

function buildPrompt(imagePath, rawText) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });
  return `You are an expense-extraction engine. Read the screenshot at this exact path:

${imagePath}

Use the Read tool on that path to look at the image. It is a screenshot of a payment, receipt, bill, order confirmation, bank/UPI notification, or a list of transactions.

Local OCR of the same image (may contain errors - the image itself is the source of truth, use this only as a hint for faint or small text):
--- OCR START ---
${rawText.slice(0, 4000) || '(no text detected)'}
--- OCR END ---

Today is ${weekday}, ${todayISO}. Resolve relative dates ("Today", "Yesterday", "2 days ago") against that. If a screenshot shows a date with no year, assume the most recent past occurrence of that date.

Extract EVERY distinct transaction visible. A single payment screenshot yields one entry; a statement or transaction-list screenshot yields one entry per row.

Reply with ONLY a JSON object, no prose, no markdown fences:

{
  "is_expense": true,
  "reason": "",
  "source_app": "Google Pay",
  "expenses": [
    {
      "merchant": "Blue Tokai Coffee Roasters",
      "amount": 1248.00,
      "currency": "INR",
      "spent_at": "2026-08-27",
      "spent_time": "16:02",
      "category": "Food & Dining",
      "payment_method": "UPI",
      "account": "HDFC Bank ****1234",
      "txn_ref": "429183746512",
      "direction": "debit",
      "note": "",
      "confidence": 0.95
    }
  ]
}

Rules:
- "amount": a positive number only. No currency symbols, no thousands separators.
- "currency": ISO 4217 code (INR, USD, EUR, GBP...). Infer from the symbol; the rupee sign is INR.
- "spent_at": strict YYYY-MM-DD. If genuinely absent, use ${todayISO} and drop confidence to 0.5.
- "spent_time": 24h HH:MM, or null if not shown.
- "category": exactly one of ${JSON.stringify(CATEGORIES)}.
- "direction": "debit" for money you spent, "credit" for refunds, cashback or money received.
- "payment_method": UPI, Credit Card, Debit Card, Net Banking, Wallet, Cash, or null.
- "merchant": the payee/store as a human would name it. Strip UPI handles and "Pay to".
- "confidence": 0 to 1. Below 0.7 flags the entry for manual review.
- If the image is NOT a financial transaction, return {"is_expense": false, "reason": "<what it actually is>", "expenses": []}.
- Never invent an amount. If no amount is legible, set is_expense false with reason "amount not legible".`;
}

function parseJSON(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model output');
  return JSON.parse(t.slice(start, end + 1));
}

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalise(e, todayISO) {
  const amount = Math.abs(num(e.amount));
  const cat = CATEGORIES.find((c) => c.toLowerCase() === String(e.category || '').toLowerCase()) || 'Other';
  const spentAt = ISO_DATE.test(String(e.spent_at || '')) ? e.spent_at : todayISO;
  const time = /^\d{2}:\d{2}$/.test(String(e.spent_time || '')) ? e.spent_time : null;
  let conf = num(e.confidence);
  if (conf <= 0 || conf > 1) conf = 0.6;
  const merchant = String(e.merchant || '').trim() || 'Unknown';
  const needsReview = conf < 0.7 || amount <= 0 || merchant === 'Unknown' ? 1 : 0;
  return {
    merchant,
    amount,
    currency: (String(e.currency || 'INR').toUpperCase().match(/[A-Z]{3}/) || ['INR'])[0],
    spent_at: spentAt,
    spent_time: time,
    category: cat,
    payment_method: e.payment_method ? String(e.payment_method).slice(0, 40) : null,
    account: e.account ? String(e.account).slice(0, 60) : null,
    txn_ref: e.txn_ref ? String(e.txn_ref).slice(0, 60) : null,
    note: e.note ? String(e.note).slice(0, 300) : null,
    direction: String(e.direction || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
    confidence: conf,
    needs_review: needsReview
  };
}

/**
 * Read a screenshot and return { rawText, sourceApp, expenses[], isExpense, reason }.
 * Throws only if the model call itself fails.
 */
async function extract(imagePath) {
  const rawText = await ocr(imagePath);
  const prompt = buildPrompt(imagePath, rawText);

  let stdout;
  try {
    ({ stdout } = await run('claude', [
      '-p', prompt,
      '--allowedTools', 'Read',
      '--output-format', 'text'
    ], { timeout: CLAUDE_TIMEOUT_MS, cwd: ROOT }));
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim().slice(0, 400);
    throw new Error(`claude CLI failed: ${detail || err.code || 'unknown error'}`);
  }

  const data = parseJSON(stdout);
  const todayISO = new Date().toISOString().slice(0, 10);
  const list = Array.isArray(data.expenses) ? data.expenses : [];
  return {
    rawText,
    sourceApp: data.source_app ? String(data.source_app).slice(0, 60) : null,
    isExpense: data.is_expense !== false && list.length > 0,
    reason: data.reason ? String(data.reason).slice(0, 300) : '',
    expenses: list.map((e) => normalise(e, todayISO)).filter((e) => e.amount > 0)
  };
}

module.exports = { extract, ocr };
