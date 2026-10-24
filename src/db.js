'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'expenses.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY,
  sha256     TEXT UNIQUE NOT NULL,
  filename   TEXT,
  path       TEXT NOT NULL,
  thumb      TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | working | done | failed | ignored
  error      TEXT,
  raw_text   TEXT,
  source_app TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY,
  image_id       INTEGER REFERENCES images(id) ON DELETE CASCADE,
  merchant       TEXT NOT NULL DEFAULT 'Unknown',
  amount         REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'INR',
  spent_at       TEXT NOT NULL,          -- YYYY-MM-DD
  spent_time     TEXT,                   -- HH:MM
  category       TEXT NOT NULL DEFAULT 'Other',
  payment_method TEXT,
  account        TEXT,
  txn_ref        TEXT,
  note           TEXT,
  direction      TEXT NOT NULL DEFAULT 'debit',  -- debit | credit
  confidence     REAL NOT NULL DEFAULT 1,
  needs_review   INTEGER NOT NULL DEFAULT 0,
  edited         INTEGER NOT NULL DEFAULT 0,
  deleted        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(spent_at);
CREATE INDEX IF NOT EXISTS idx_exp_deleted ON expenses(deleted);
CREATE INDEX IF NOT EXISTS idx_img_status ON images(status);
`);

const now = () => new Date().toISOString();

const CATEGORIES = [
  'Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities',
  'Entertainment', 'Health', 'Travel', 'Rent', 'Subscriptions',
  'Education', 'Transfers', 'Cash', 'Other'
];

module.exports = { db, now, CATEGORIES, ROOT, DATA };
