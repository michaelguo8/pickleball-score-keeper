'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../formats.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const appScript = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function harness(storage = new Map()) {
  const app = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    window: { PBFormats: F, location: { href: '' } },
    document: {
      getElementById: id => id === 'app' ? app : null,
      addEventListener: () => {},
      visibilityState: 'visible'
    },
    navigator: {},
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  vm.runInContext(appScript, context);
  return { app, storage, run: code => vm.runInContext(code, context) };
}

const freshGame = `S = freshState([
  { name: 'Team A', players: ['A1', 'A2', 'A3', 'A4'] },
  { name: 'Team B', players: ['B1', 'B2', 'B3', 'B4'] }
], '4v4')`;

test('scoring hint appears only after the first Start rallies', () => {
  const h = harness();
  h.run(`${freshGame}; startPlay()`);
  assert.match(h.app.innerHTML, /Tap the team that won the rally\./);
  assert.match(h.app.innerHTML, /class="scoring-hint-close" onclick="dismissScoreHint\(event\)"/);
  assert.equal(h.storage.get('pb-score-scoring-hint-v1'), '1');

  h.run(`hideScoreHint(); S.phase = 'between'; startPlay()`);
  assert.doesNotMatch(h.app.innerHTML, /Tap the team that won the rally\./);
});

test('dismissing the scoring hint consumes the event without changing the score', () => {
  const h = harness();
  h.run(`${freshGame}; S.phase = 'play'; scoreHintVisible = true; render()`);
  const result = h.run(`JSON.stringify((() => {
    let prevented = false;
    let stopped = false;
    dismissScoreHint({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    return { prevented, stopped, visible: scoreHintVisible, scores: S.scores };
  })())`);
  assert.equal(result, '{"prevented":true,"stopped":true,"visible":false,"scores":[0,0]}');
});

test('scoring hint does not pass pointer events through to the court', () => {
  assert.doesNotMatch(styles, /\.scoring-hint\s*\{[^}]*pointer-events:\s*none/s);
});

test('scoring hint remains dismissed in a new session', () => {
  const h = harness(new Map([['pb-score-scoring-hint-v1', '1']]));
  h.run(`${freshGame}; startPlay()`);
  assert.doesNotMatch(h.app.innerHTML, /Tap the team that won the rally\./);
});

test('player-name disclosure is rendered before the team inputs', () => {
  const h = harness();
  assert.ok(h.app.innerHTML.indexOf('Add player names') < h.app.innerHTML.indexOf('class="team-cards"'));
});

test('short landscape visually reorders team inputs before the player disclosure', () => {
  assert.match(styles, /\.setup-scroll \{ display: flex; flex-direction: column; \}/);
  assert.match(styles, /\.team-cards \{ order: 1; width: 100%; \}/);
  assert.match(styles, /\.disclosure \{ order: 2; margin: 6px auto 0; \}/);
});

test('index loads separated styles and scripts in dependency order', () => {
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css">/);
  assert.ok(html.indexOf('./formats.js') < html.indexOf('./app.js'));
  assert.doesNotMatch(html, /<style>|<script>/);
});

test('service worker caches every separated runtime file', () => {
  for (const file of ['./styles.css', './formats.js', './app.js']) {
    assert.ok(serviceWorker.includes(`'${file}'`), `${file} should be cached`);
  }
});

test('scoring zones commit on click rather than pointer down', () => {
  const h = harness();
  h.run(`${freshGame}; S.phase = 'play'; render()`);
  assert.match(h.app.innerHTML, /class="zone a" onclick="point\(0\)"/);
  assert.match(h.app.innerHTML, /class="zone b" onclick="point\(1\)"/);
  assert.doesNotMatch(h.app.innerHTML, /onpointerdown="point\(/);
});
