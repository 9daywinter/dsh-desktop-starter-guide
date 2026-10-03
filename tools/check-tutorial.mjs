#!/usr/bin/env node
/**
 * Structural check for the single-file tutorial.
 *
 * The guide ships as one self-contained HTML file with inline CSS and JS and no
 * build step, so this script is the only safety net against a broken edit. It
 * checks that the page stays self-contained, that the inline script parses and
 * initialises, that every element the script looks up actually exists, and that
 * no id is declared twice.
 *
 * Usage: node tools/check-tutorial.mjs [path-to-html]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const defaultHtml = resolve(here, '..', 'dsh-desktop-新手从零上手指南.html');
const htmlPath = process.argv[2] ? resolve(process.argv[2]) : defaultHtml;

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function check(label, condition, detail) {
  if (condition) {
    notes.push(`  PASS  ${label}`);
  } else {
    fail(`${label}${detail === undefined ? '' : `  -> ${detail}`}`);
  }
}

let html;
try {
  html = readFileSync(htmlPath, 'utf8');
} catch (error) {
  console.error(`cannot read ${htmlPath}: ${error.message}`);
  process.exit(1);
}

console.log(`checking ${htmlPath}`);
console.log(`  ${Buffer.byteLength(html, 'utf8')} bytes`);

/* ---------- 1. self-contained ---------- */
const externalScript = /<script[^>]*\ssrc=/i.test(html);
const externalStyle = /<link[^>]*rel=["']?stylesheet/i.test(html);
check('no external <script src>', !externalScript);
check('no external stylesheet <link>', !externalStyle);
check('exactly one inline <script>', (html.match(/<script/gi) || []).length === 1);
check('exactly one inline <style>', (html.match(/<style/gi) || []).length === 1);

/* ---------- 2. no remote requests at runtime ---------- */
const ns = new Set();
for (const attribute of ['src', 'href', 'action']) {
  const re = new RegExp(`${attribute}=["'](https?:)?//[^"']*`, 'gi');
  for (const m of html.match(re) || []) ns.add(m);
}
check('no protocol-relative or absolute runtime URLs', ns.size === 0, [...ns].join(' | '));

/* ---------- 3. unique ids ---------- */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
check('no duplicate id attributes', duplicates.length === 0, [...new Set(duplicates)].join(', '));
console.log(`  ${ids.length} id attributes, ${new Set(ids).size} unique`);

/* ---------- 4. every getElementById target exists ---------- */
const idSet = new Set(ids);
const targets = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
const missing = [...new Set(targets)].filter((t) => !idSet.has(t));
check('all getElementById targets are declared', missing.length === 0, missing.join(', '));
console.log(`  ${new Set(targets).size} getElementById targets resolved`);

/* ---------- 5. the inline script parses and initialises ---------- */
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  fail('no inline script found');
} else {
  const code = match[1];
  console.log(`  inline script: ${code.length} chars`);

  // Minimal DOM stub: enough for the page's init path to run to completion.
  const store = new Map();
  let ready = false;

  function makeEl(id) {
    const el = {
      id: id || '',
      _listeners: {},
      _attrs: {},
      _text: '',
      _html: '',
      _ver: 0,
      _scanned: -1,
      className: '',
      checked: false,
      style: {},
      offsetTop: 0,
      classList: { _s: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
      removeEventListener() {},
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return this._attrs[k] ?? null; },
      querySelectorAll() { return []; },
      appendChild() {},
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) { el._html = String(v); },
      configurable: true,
    });
    Object.defineProperty(el, 'textContent', {
      get() { return el._text; },
      set(v) { el._text = String(v); },
      configurable: true,
    });
    return el;
  }

  function getEl(id) {
    if (!store.has(id)) store.set(id, makeEl(id));
    return store.get(id);
  }

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById: getEl,
      querySelectorAll() { return []; },
      querySelector() { return null; },
      documentElement: { setAttribute() {}, getAttribute() { return null; } },
      createRange() { return { selectNodeContents() {} }; },
      addEventListener() {},
      body: makeEl('body'),
    },
    window: {
      addEventListener() {},
      scrollY: 0,
      scrollTo() {},
      getSelection() { return { removeAllRanges() {}, addRange() {} }; },
      matchMedia() { return { matches: false, addEventListener() {} }; },
    },
    localStorage: {
      _d: {},
      getItem(k) { return Object.hasOwn(this._d, k) ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  try {
    vm.runInContext(code, sandbox, { filename: 'tutorial-inline.js' });
    check('inline script parses and initialises without throwing', true);
  } catch (error) {
    check('inline script parses and initialises without throwing', false, error.message);
  }

  // the walkthrough exposes a small hook; its absence means init did not finish
  const guide = sandbox.window.__dshGuide;
  check('exposes window.__dshGuide after init', Boolean(guide));
  if (guide) {
    check('__dshGuide.state() reports a step', typeof guide.state === 'function' && Boolean(guide.state().step));
  }
}

/* ---------- 6. expected sections exist ---------- */
const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
console.log(`  sections: ${sections.join(', ')}`);
check('has at least the four core topic sections', sections.length >= 4, String(sections.length));

const navTargets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
const dangling = [...new Set(navTargets)].filter((t) => !idSet.has(t));
check('no dangling in-page links', dangling.length === 0, dangling.join(', '));

/* ---------- report ---------- */
console.log('');
for (const line of notes) console.log(line);

if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}

console.log(`\nall ${notes.length} checks passed`);
