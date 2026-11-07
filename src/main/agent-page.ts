/*
 * Scripts the agent runs inside a web page. They run in an isolated world (like an
 * extension's content script): the page's own JavaScript cannot see them, change them or
 * read the list of elements they keep. Kept as plain JS text so the bundler never rewrites them.
 */

export const AGENT_WORLD = 1002

export interface PageElement {
  id: number
  role: string
  label: string
  type?: string
  value?: string
  options?: string[]
  checked?: boolean
  href?: string
  /** Password, card, security code or ID-document field: only the user may fill it. */
  sensitive?: boolean
  /** Submits a form. */
  submit?: boolean
  /** Part of a search box. */
  search?: boolean
  disabled?: boolean
  inView: boolean
}

export interface PageSnapshot {
  url: string
  title: string
  text: string
  elements: PageElement[]
  more: number
  /** Scroll position in %, or -1 when the page does not scroll. */
  scroll: number
}

const PRELUDE = String.raw`
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const SENS = /pass|senha|contrase|card|cart[aã]o|tarjeta|cc-?(num|csc|exp|name)|cvv|cvc|cpf|cnpj|rg\b|iban|security.?code|c[oó]digo.?de.?seguran|pin\b/i;
const isSensitive = (e) => {
  if (!e || !e.tagName) return false;
  if (e.tagName === 'INPUT' && e.type === 'password') return true;
  const ac = (e.getAttribute('autocomplete') || '').toLowerCase();
  if (/cc-|password|one-time-code/.test(ac)) return true;
  return SENS.test([e.name, e.id, e.getAttribute('aria-label'), e.placeholder, ac].join(' '));
};
const els = () => globalThis.__halyardEls || [];
const flash = (r) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 6) +
    'px;border:2px solid #8b5cf6;border-radius:6px;box-shadow:0 0 0 4px rgba(139,92,246,.25);pointer-events:none;z-index:2147483647;transition:opacity .4s';
  document.documentElement.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, 800);
};
const get = (id) => { const e = els()[id - 1]; return e && e.isConnected ? e : null; };
`

export const SNAPSHOT_JS = String.raw`(() => {
${PRELUDE}
const MAX_EL = 110, MAX_TEXT = 3500;
const vw = innerWidth, vh = innerHeight;
const shown = (e) => {
  const r = e.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const st = getComputedStyle(e);
  if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) return null;
  return r;
};
const labelOf = (e) => {
  let s = e.getAttribute('aria-label') || '';
  if (!s) s = (e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => (document.getElementById(id) || {}).innerText || '').join(' ');
  if (!s && e.labels && e.labels.length) s = e.labels[0].innerText;
  if (!s && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA')) {
    if (/^(submit|button|reset)$/.test(e.type)) s = e.value;
    else s = e.placeholder || e.title || e.name || '';
  }
  if (!s) s = e.innerText || '';
  if (!s) { const img = e.querySelector('img[alt]'); s = e.title || (img && img.alt) || ''; }
  return cut(clean(s), 80);
};
const searchField = (x) => !!x && x.tagName && (x.type === 'search' || x.getAttribute('role') === 'searchbox' || /^(q|query|search|s|k|busca|pesquisa|search_query)$/i.test(x.name || ''));
const searchy = (e) => {
  if (searchField(e) || e.closest('[role=search]')) return true;
  const f = e.form || e.closest('form');
  if (!f) return false;
  const all = Array.from(f.elements);
  return f.getAttribute('role') === 'search' || (all.some(searchField) && !all.some((x) => x.type === 'password'));
};
const SEL = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[role=combobox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
const found = [];
for (const e of document.querySelectorAll(SEL)) {
  if (found.length >= 700) break;
  if (e.closest('[aria-hidden=true]')) continue;
  const r = shown(e);
  if (!r) continue;
  found.push({ e, r, inView: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw });
}
const ranked = found.slice().sort((a, b) => (Number(b.inView) - Number(a.inView)) || (Math.abs(a.r.top) - Math.abs(b.r.top)));
const picked = ranked.slice(0, MAX_EL).sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
const list = [];
globalThis.__halyardEls = list;
const elements = picked.map(({ e, inView }) => {
  const id = list.push(e);
  const tag = e.tagName.toLowerCase();
  const role = e.getAttribute('role') || ({ a: 'link', input: 'input', textarea: 'textarea', select: 'select', button: 'button', summary: 'button' })[tag] || tag;
  const o = { id, role, label: labelOf(e), inView };
  if (tag === 'input') o.type = e.type;
  const field = tag === 'input' || tag === 'textarea' || e.isContentEditable;
  if (field && isSensitive(e)) o.sensitive = true;
  else if (tag === 'input' && (e.type === 'checkbox' || e.type === 'radio')) o.checked = e.checked;
  else if (tag === 'input' || tag === 'textarea') o.value = cut(e.value || '', 60);
  if (tag === 'select') {
    o.value = cut(clean((e.selectedOptions[0] || {}).text || ''), 40);
    o.options = Array.from(e.options).slice(0, 15).map((x) => cut(clean(x.text), 30));
  }
  if (tag === 'a') { try { const u = new URL(e.href); o.href = cut(u.host + u.pathname, 70); } catch (_) {} }
  const form = e.form || e.closest('form');
  if (form && ((tag === 'button' && e.type === 'submit') || (tag === 'input' && (e.type === 'submit' || e.type === 'image')))) o.submit = true;
  if (searchy(e)) o.search = true;
  if (e.disabled) o.disabled = true;
  return o;
});
// text near the visible part of the page (not hidden text)
let text = '';
const lo = -vh * 0.25, hi = vh * 1.75;
const ok = new Map();
const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
for (let n = walker.nextNode(); n && text.length < MAX_TEXT; n = walker.nextNode()) {
  const p = n.parentElement;
  if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/i.test(p.tagName)) continue;
  const t = clean(n.nodeValue);
  if (!t) continue;
  let good = ok.get(p);
  if (good === undefined) {
    const r = p.getBoundingClientRect();
    good = r.width > 0 && r.height > 0 && r.bottom > lo && r.top < hi && getComputedStyle(p).visibility !== 'hidden';
    ok.set(p, good);
  }
  if (good) text += t + ' ';
}
const se = document.scrollingElement || document.documentElement;
const max = Math.max(0, se.scrollHeight - vh);
return { url: location.href, title: cut(document.title || '', 120), text: cut(text.trim(), MAX_TEXT), elements, more: Math.max(0, found.length - picked.length), scroll: max > 20 ? Math.round((se.scrollTop / max) * 100) : -1 };
})()`

/** Bring an element into view and return where to click it. */
export const pointJs = (id: number): string => String.raw`(() => {
${PRELUDE}
const e = get(${id});
if (!e) return { error: 'gone' };
e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
const r = e.getBoundingClientRect();
const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
const hit = document.elementFromPoint(x, y);
// notice whether the real click below reaches the element
globalThis.__halyardHit = false;
const on = (ev) => { if (ev.target === e || e.contains(ev.target)) globalThis.__halyardHit = true; };
document.addEventListener('click', on, true);
setTimeout(() => document.removeEventListener('click', on, true), 4000);
flash(r);
return { x, y, clear: !!hit && (hit === e || e.contains(hit) || hit.contains(e)), disabled: !!e.disabled };
})()`

export const clickFallbackJs = (id: number): string => String.raw`(() => {
${PRELUDE}
const e = get(${id});
if (!e) return { error: 'gone' };
e.click();
return { ok: true };
})()`

/** Focus a field and select what is in it, so typing replaces it. Re-checks the field is not sensitive. */
export const focusJs = (id: number): string => String.raw`(() => {
${PRELUDE}
const e = get(${id});
if (!e) return { error: 'gone' };
const field = e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable;
if (!field || (e.tagName === 'INPUT' && /^(checkbox|radio|submit|button|file|image|reset|range|color)$/.test(e.type))) return { error: 'not-field' };
if (isSensitive(e)) return { error: 'sensitive' };
e.scrollIntoView({ block: 'center', behavior: 'instant' });
flash(e.getBoundingClientRect());
e.focus();
if (e.isContentEditable) {
  const range = document.createRange(); range.selectNodeContents(e);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
} else if (typeof e.select === 'function') e.select();
const a = document.activeElement;
return { ok: a === e || e.contains(a) };
})()`

export const selectJs = (id: number, option: string): string => String.raw`(() => {
${PRELUDE}
const e = get(${id});
if (!e) return { error: 'gone' };
if (e.tagName !== 'SELECT') return { error: 'not-select' };
const want = ${JSON.stringify(option)}.trim().toLowerCase();
const opts = Array.from(e.options);
const o = opts.find((x) => clean(x.text).toLowerCase() === want) || opts.find((x) => x.value.toLowerCase() === want) || opts.find((x) => clean(x.text).toLowerCase().includes(want));
if (!o) return { error: 'no-option' };
flash(e.getBoundingClientRect());
e.value = o.value;
e.dispatchEvent(new Event('input', { bubbles: true }));
e.dispatchEvent(new Event('change', { bubbles: true }));
return { ok: true, text: clean(o.text) };
})()`

export const scrollJs = (down: boolean): string =>
  `(() => { scrollBy({ top: ${down ? 1 : -1} * innerHeight * 0.8, behavior: 'instant' }); return true })()`

/** Script files the page loaded: the only ones the agent may read. */
export const SCRIPTS_JS = `Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 200)`
