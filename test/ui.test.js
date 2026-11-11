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

test('10-point 3v3 plays nine 10-rally matchups before a golden point at 45-all', () => {
  let h = harness();
  h.run("pickFormat('3v3')");
  assert.match(h.app.innerHTML, /10 every round<\/button>/);
  h.run("pickFormat('3v3-10'); openRules()");
  assert.match(h.app.innerHTML, /45–45/);
  assert.equal(h.app.innerHTML.match(/10 points per matchup/g).length, 3);
  h.run('closeRules(); startGameFromSetup()');
  for (let round = 0; round < 3; round++) {
    h = harness(h.storage);
    assert.equal(h.run('S.format'), '3v3-10');
    for (let matchup = 0; matchup < 3; matchup++) {
      assert.equal(h.run('S.phase'), 'between');
      assert.equal(h.run('S.round'), round);
      assert.equal(h.run('S.matchup'), matchup);
      h.run('startPlay(); for (let p = 0; p < 9; p++) point(p % 2)');
      assert.equal(h.run('S.phase'), 'play');
      h.run('point(1)');
    }
  }
  assert.equal(h.run('S.overtime'), true);
  assert.equal(h.run('S.scores.join("-")'), '45-45');
  h.run('startPlay(); point(0)');
  assert.equal(h.run('S.phase'), 'done');
});

test('scoring hint appears only after the first Start rallies', () => {
  const h = harness();
  h.run(`${freshGame}; startPlay()`);
  assert.match(h.app.innerHTML, /Tap the team that won the rally\./);
  assert.match(h.app.innerHTML, /class="scoring-hint-close" onclick="dismissScoreHint\(event\)"/);
  assert.equal(h.storage.get('pb-score-scoring-hint-v1'), '1');

  h.run(`hideScoreHint(); S.phase = 'between'; startPlay()`);
  assert.doesNotMatch(h.app.innerHTML, /Tap the team that won the rally\./);
});

test('unnamed 3v3 pairings call one player number and carry the server into the next matchup', () => {
  const h = harness();
  h.run("pickFormat('3v3'); startGameFromSetup()");
  assert.match(h.app.innerHTML, /<strong>Player 1<\/strong> from each team/);
  h.run('startPlay(); for (let p = 0; p < 10; p++) point(p % 2)');
  assert.match(h.app.innerHTML, /<strong>Player 2<\/strong> from each team/);
  assert.match(h.app.innerHTML, /Team B serves next/);
});

test('unnamed 3v4 players are identified by team and position during rotations', () => {
  const h = harness();
  h.run("pickFormat('3v4'); startGameFromSetup(); startPlay(); for (let p = 0; p < 8; p++) point(p % 2)");
  const sub = h.run('subOverlay()');
  assert.match(sub, /Team B/);
  assert.match(sub, /Player 2 subs on now/);
  assert.match(sub, /taking over from Player 1/);
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
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css\?v=\d+">/);
  assert.ok(html.indexOf('./formats.js') < html.indexOf('./app.js'));
  assert.doesNotMatch(html, /<style>|<script>/);
});

test('service worker caches every separated runtime file', () => {
  for (const file of ['./styles.css', './formats.js', './app.js']) {
    const asset = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => match[1]).find(url => url.split('?')[0] === file);
    assert.ok(asset && serviceWorker.includes(`'${asset}'`), `${file} should be cached at its HTML URL`);
  }
});

test('scoring zones commit on click rather than pointer down', () => {
  const h = harness();
  h.run(`${freshGame}; S.phase = 'play'; render()`);
  assert.match(h.app.innerHTML, /class="zone a" onclick="point\(0\)"/);
  assert.match(h.app.innerHTML, /class="zone b" onclick="point\(1\)"/);
  assert.doesNotMatch(h.app.innerHTML, /onpointerdown="point\(/);
});
