'use strict';

const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const COLORS = ['#6ee7a8', '#4ea8de', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#38bdf8',
  '#facc15', '#34d399', '#fb923c', '#c084fc', '#2dd4bf', '#e879f9', '#94a3b8'];

let state = null, sig = '', busyPoll = false;
let filters = { month: '', q: '', review: false };

/* ---------------------------------------------------------------- helpers */

function symbol(cur) {
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US',
      { style: 'currency', currency: cur || 'INR' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value || cur;
  } catch { return cur; }
}
function money(v, cur) {
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US',
      { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 2 }).format(v || 0);
  } catch { return `${cur || ''} ${(v || 0).toFixed(2)}`; }
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}
function monthLabel(m) {
  if (!m) return 'All time';
  const [y, mm] = m.split('-');
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function dayLabel(d) {
  const dt = new Date(d + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - dt) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) +
    (dt.getFullYear() !== today.getFullYear() ? ` ${dt.getFullYear()}` : '');
}
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};

/* ----------------------------------------------------------------- upload */

async function upload(fileList) {
  const files = [...fileList].filter((f) => /^image\//.test(f.type) || /\.(heic|pdf)$/i.test(f.name));
  if (!files.length) return toast('No images in that drop');
  toast(`Reading ${files.length} screenshot${files.length > 1 ? 's' : ''}…`);
  const payload = await Promise.all(files.map((f) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res({ name: f.name || 'screenshot.png', data: fr.result });
    fr.readAsDataURL(f);
  })));
  try {
    const r = await api('/api/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payload })
    });
    const dupes = r.results.filter((x) => x.duplicate).length;
    toast(dupes ? `${r.accepted - dupes} queued, ${dupes} already logged` : `${r.accepted} queued, reading now`);
    busyPoll = true; refresh();
  } catch (e) { toast('Upload failed: ' + e.message); }
}

/* ------------------------------------------------------------------ charts */

function donut(cats, cur) {
  const total = cats.reduce((s, c) => s + c.total, 0);
  const wrap = el('div', 'donut');
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 130 130');
  svg.setAttribute('width', '130'); svg.setAttribute('height', '130');
  svg.style.flex = 'none';
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', 65); ring.setAttribute('cy', 65); ring.setAttribute('r', R);
  ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#232a33'); ring.setAttribute('stroke-width', 18);
  svg.appendChild(ring);
  cats.slice(0, 14).forEach((c, i) => {
    const frac = total ? c.total / total : 0;
    const arc = document.createElementNS(ns, 'circle');
    arc.setAttribute('cx', 65); arc.setAttribute('cy', 65); arc.setAttribute('r', R);
    arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', COLORS[i % COLORS.length]);
    arc.setAttribute('stroke-width', 18);
    arc.setAttribute('stroke-dasharray', `${(frac * C).toFixed(2)} ${C.toFixed(2)}`);
    arc.setAttribute('stroke-dashoffset', (-off * C).toFixed(2));
    arc.setAttribute('transform', 'rotate(-90 65 65)');
    const t = document.createElementNS(ns, 'title');
    t.textContent = `${c.category}: ${money(c.total, cur)}`;
    arc.appendChild(t);
    svg.appendChild(arc);
    off += frac;
  });
  wrap.appendChild(svg);
  const lg = el('div', 'legend');
  cats.slice(0, 7).forEach((c, i) => {
    const row = el('div', 'lg');
    const sw = el('span', 'sw'); sw.style.background = COLORS[i % COLORS.length];
    row.append(sw, el('span', 'nm', c.category), el('span', 'am', money(c.total, cur)));
    lg.appendChild(row);
  });
  if (cats.length > 7) lg.appendChild(el('div', 'lg', `+${cats.length - 7} more categories`));
  wrap.appendChild(lg);
  return wrap;
}

function bars(byDay, cur) {
  const box = el('div');
  if (!byDay.length) { box.append(el('p', 'sub', 'Nothing logged yet.')); return box; }
  const max = Math.max(...byDay.map((d) => d.total));
  const row = el('div', 'bars');
  byDay.forEach((d) => {
    const b = el('div', 'bar');
    b.style.height = Math.max(2, (d.total / max) * 100) + '%';
    b.append(el('span', null, `${dayLabel(d.day)} · ${money(d.total, cur)}`));
    row.appendChild(b);
  });
  box.appendChild(row);
  const ax = el('div', 'axis');
  ax.append(el('span', null, dayLabel(byDay[0].day)),
    el('span', null, dayLabel(byDay[byDay.length - 1].day)));
  box.appendChild(ax);
  return box;
}

/* ------------------------------------------------------------------ render */

function renderStats(s) {
  const box = $('#stats'); box.innerHTML = '';
  const others = (s.others || []).filter((o) => o.total > 0);
  const otherLine = others.length
    ? 'plus ' + others.map((o) => money(o.total, o.currency)).join(' · ')
    : `${s.count} transaction${s.count === 1 ? '' : 's'}`;
  const items = [
    ['Total spent', money(s.total, s.currency), otherLine, 'acc'],
    ['Per active day', money(s.perDay, s.currency), `${s.activeDays} day${s.activeDays === 1 ? '' : 's'} with spend`],
    ['Top category', s.byCategory[0]?.category || '—', s.byCategory[0] ? money(s.byCategory[0].total, s.currency) : 'no data'],
    ['Money in', money(s.credits, s.currency), 'refunds & credits']
  ];
  for (const [k, v, sub, cls] of items) {
    const c = el('div', 'stat' + (cls ? ' ' + cls : ''));
    c.append(el('div', 'k', k), el('div', 'v', v), el('div', 's', sub));
    box.appendChild(c);
  }
}

function renderCharts(s) {
  const box = $('#charts'); box.innerHTML = '';
  const p1 = el('div', 'panel'); p1.append(el('h3', null, 'Where it went'));
  p1.appendChild(s.byCategory.length ? donut(s.byCategory, s.currency) : el('p', 'sub', 'Nothing logged yet.'));
  const p2 = el('div', 'panel'); p2.append(el('h3', null, 'Daily spend'));
  p2.appendChild(bars(s.byDay, s.currency));
  if (s.byMerchant.length) {
    p2.append(el('h3', null, 'Top merchants'));
    p2.lastChild.style.marginTop = '20px';
    const list = el('div', 'mlist');
    s.byMerchant.slice(0, 5).forEach((m) => {
      const r = el('div', 'mrow');
      r.append(el('span', 'nm', m.merchant), el('span', 'n', `×${m.n}`), el('span', 'am', money(m.total, s.currency)));
      list.appendChild(r);
    });
    p2.appendChild(list);
  }
  box.append(p1, p2);
}

function renderPipe(p) {
  const box = $('#pipe');
  if (!p.items.length) { box.innerHTML = ''; return; }
  box.innerHTML = '';
  const panel = el('div', 'pipe');
  const busy = p.items.filter((i) => i.status === 'pending' || i.status === 'working').length;
  panel.append(el('h3', null, busy ? `Reading ${busy} screenshot${busy > 1 ? 's' : ''}…` : 'Needs your attention'));
  panel.lastChild.style.cssText = 'font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);font-weight:650';
  const items = el('div', 'pitems');
  p.items.forEach((i) => {
    const it = el('div', 'pitem ' + i.status);
    if (i.status === 'working' || i.status === 'pending') it.appendChild(el('div', 'spin'));
    else { const im = new Image(); im.src = `/img/${i.id}/thumb`; im.alt = ''; it.appendChild(im); }
    const t = el('div', 't');
    t.append(el('div', 'n', i.filename || `image ${i.id}`),
      el('div', 'st', i.status === 'working' ? 'reading the image…'
        : i.status === 'pending' ? 'queued'
          : i.status === 'ignored' ? (i.error || 'no transaction found')
            : (i.error || 'failed')));
    it.appendChild(t);
    if (i.status === 'failed' || i.status === 'ignored') {
      const retry = el('button', 'btn sm gh', 'Retry');
      retry.onclick = () => api(`/api/images/${i.id}/retry`, { method: 'POST' }).then(() => { busyPoll = true; refresh(); });
      const dis = el('button', 'x', '×');
      dis.title = 'Discard this screenshot';
      dis.onclick = () => api(`/api/images/${i.id}`, { method: 'DELETE' }).then(refresh);
      it.append(retry, dis);
    }
    items.appendChild(it);
  });
  panel.appendChild(items);
  box.appendChild(panel);
}

function renderTable(rows, cats, cur) {
  const box = $('#table'); box.innerHTML = '';
  if (!rows.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, filters.q || filters.review ? 'Nothing matches' : 'No expenses yet'),
      el('div', null, filters.q || filters.review ? 'Try clearing the filters.'
        : 'Drop a payment screenshot above and it will show up here in a few seconds.'));
    box.appendChild(e);
    return;
  }
  const t = el('table');
  t.innerHTML = `<thead><tr>
    <th style="width:46px"></th><th style="width:96px">Date</th><th>Merchant</th>
    <th style="width:170px">Category</th><th style="width:158px;text-align:right">Amount</th>
    <th style="width:130px" class="hide-s">Paid with</th><th style="width:36px"></th></tr></thead>`;
  const tb = el('tbody');

  for (const r of rows) {
    const tr = el('tr', (r.needs_review ? 'rev ' : '') + (r.direction === 'credit' ? 'cred' : ''));

    const tdImg = el('td');
    if (r.img_id) {
      const im = new Image(); im.className = 'th'; im.src = `/img/${r.img_id}/thumb`;
      im.alt = 'Screenshot'; im.title = 'View original screenshot';
      im.onclick = () => { $('#lbimg').src = `/img/${r.img_id}/full`; $('#lb').classList.add('on'); };
      tdImg.appendChild(im);
    } else tdImg.appendChild(el('div', 'noimg', '✎'));
    tr.appendChild(tdImg);

    const tdDate = el('td', 'dtd');
    tdDate.append(el('div', null, dayLabel(r.spent_at)),
      el('div', 'sub', r.spent_time || (r.direction === 'credit' ? 'credit' : '')));
    tdDate.title = r.spent_at + (r.spent_time ? ' ' + r.spent_time : '');
    tr.appendChild(tdDate);

    const tdM = el('td');
    const mi = el('input', 'ed'); mi.value = r.merchant; mi.dataset.f = 'merchant'; mi.dataset.id = r.id;
    tdM.appendChild(mi);
    if (r.note || r.txn_ref) tdM.appendChild(el('div', 'sub', r.note || `ref ${r.txn_ref}`));
    tr.appendChild(tdM);

    const tdC = el('td');
    const sel = el('select', 'ed'); sel.dataset.f = 'category'; sel.dataset.id = r.id;
    cats.forEach((c) => { const o = el('option', null, c); o.value = c; if (c === r.category) o.selected = true; sel.appendChild(o); });
    tdC.appendChild(sel);
    tr.appendChild(tdC);

    const tdA = el('td', 'amt');
    const aw = el('div', 'amtw');
    aw.appendChild(el('span', 'cur', (r.direction === 'credit' ? '+' : '') + symbol(r.currency)));
    const ai = el('input', 'ed amt'); ai.type = 'number'; ai.step = '0.01'; ai.value = r.amount.toFixed(2);
    ai.dataset.f = 'amount'; ai.dataset.id = r.id;
    ai.title = `${r.currency} · confidence ${(r.confidence * 100).toFixed(0)}%${r.edited ? ' · edited by you' : ''}`;
    aw.appendChild(ai);
    tdA.appendChild(aw);
    if (r.currency !== cur) tdA.appendChild(el('div', 'sub', r.currency));
    tr.appendChild(tdA);

    const tdP = el('td', 'hide-s');
    tdP.append(el('div', null, r.payment_method || '—'));
    if (r.account) tdP.appendChild(el('div', 'sub', r.account));
    else if (r.source_app) tdP.appendChild(el('div', 'sub', r.source_app));
    tr.appendChild(tdP);

    const tdX = el('td');
    const x = el('button', 'x', '×'); x.title = 'Delete';
    x.onclick = async () => { await api(`/api/expenses/${r.id}`, { method: 'DELETE' }); toast('Deleted'); refresh(true); };
    tdX.appendChild(x);
    tr.appendChild(tdX);

    tb.appendChild(tr);
  }
  t.appendChild(tb);
  box.appendChild(t);
}

function render() {
  const s = state.summary;
  renderPipe(state.pipeline);
  renderStats(s);
  renderCharts(s);
  renderTable(state.expenses, state.categories, s.currency);

  $('#tbltitle').textContent = `${monthLabel(filters.month)} · ${state.expenses.length} shown`;
  const chip = $('#revchip');
  if (s.reviewCount) {
    chip.hidden = false;
    chip.textContent = `${s.reviewCount} need${s.reviewCount === 1 ? 's' : ''} a check`;
    chip.classList.toggle('on', filters.review);
  } else chip.hidden = true;

  const ms = $('#month');
  const want = [''].concat(state.months);
  if (ms.dataset.k !== want.join()) {
    ms.dataset.k = want.join(); ms.innerHTML = '';
    want.forEach((m) => { const o = el('option', null, monthLabel(m)); o.value = m; ms.appendChild(o); });
  }
  ms.value = filters.month;
}

/* ---------------------------------------------------------------- refresh */

async function refresh(force = false) {
  const focused = document.activeElement;
  const editing = focused && focused.classList && focused.classList.contains('ed');
  const url = `/api/state?month=${encodeURIComponent(filters.month)}&q=${encodeURIComponent(filters.q)}` +
    (filters.review ? '&review=1' : '');
  try {
    const s = await api(url);
    const next = JSON.stringify(s);
    busyPoll = s.busy > 0 || s.pipeline.working > 0 || s.pipeline.pending > 0;
    if (!force && next === sig) return;
    if (editing && !force) return;          // never yank the field out from under a keystroke
    sig = next; state = s; render();
  } catch (e) { /* server restarting; next tick will catch up */ }
}

function loop() {
  refresh();
  setTimeout(loop, busyPoll ? 1800 : 7000);
}

/* ------------------------------------------------------------------ events */

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (!t.dataset || !t.dataset.f) return;
  const body = {};
  body[t.dataset.f] = t.dataset.f === 'amount' ? parseFloat(t.value) : t.value;
  if (t.dataset.f === 'merchant' && !String(t.value).trim()) return;
  body.needs_review = 0;
  try { await api(`/api/expenses/${t.dataset.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Saved'); sig = ''; refresh(true);
  } catch (err) { toast('Save failed: ' + err.message); }
});

let dragDepth = 0;
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'dragenter') dragDepth++;
  document.body.classList.add('dragging');
}));
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); upload(files); }
});

$('#drop').onclick = () => $('#file').click();
$('#pick').onclick = () => $('#file').click();
$('#file').onchange = (e) => { if (e.target.files.length) upload(e.target.files); e.target.value = ''; };
$('#month').onchange = (e) => { filters.month = e.target.value; sig = ''; refresh(true); };
$('#revchip').onclick = () => { filters.review = !filters.review; sig = ''; refresh(true); };
$('#csv').onclick = () => { location.href = `/api/export.csv?month=${encodeURIComponent(filters.month)}`; };
$('#lb').onclick = () => $('#lb').classList.remove('on');

let qt;
$('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { filters.q = e.target.value.trim(); sig = ''; refresh(true); }, 260); };

$('#add').onclick = () => {
  const cs = $('#m_cat');
  if (!cs.options.length && state) state.categories.forEach((c) => { const o = el('option', null, c); o.value = c; cs.appendChild(o); });
  $('#m_date').value = new Date().toISOString().slice(0, 10);
  $('#modal').classList.add('on'); $('#m_merchant').focus();
};
$('#m_cancel').onclick = () => $('#modal').classList.remove('on');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('on'); };
$('#m_save').onclick = async () => {
  const b = {
    merchant: $('#m_merchant').value.trim() || 'Unknown',
    amount: parseFloat($('#m_amount').value) || 0,
    currency: ($('#m_currency').value || 'INR').toUpperCase(),
    spent_at: $('#m_date').value, spent_time: $('#m_time').value,
    category: $('#m_cat').value, direction: $('#m_dir').value, note: $('#m_note').value.trim()
  };
  if (!b.amount) return toast('Enter an amount');
  await api('/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  $('#modal').classList.remove('on');
  ['m_merchant', 'm_amount', 'm_note', 'm_time'].forEach((i) => { $('#' + i).value = ''; });
  toast('Added'); sig = ''; refresh(true);
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#lb').classList.remove('on'); $('#modal').classList.remove('on'); }
  if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); $('#q').focus(); }
});

fetch('/api/state').then((r) => r.json()).then((s) => {
  filters.month = s.months[0] || '';
  loop();
});
