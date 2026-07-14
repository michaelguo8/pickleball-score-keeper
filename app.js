'use strict';

/* ===== Rules ===== */
// Per-format rules live in formats.js (window.PBFormats); the active game reads
// them through fmt(). STORE_KEY is shared — a saved game records its own format.
const F = window.PBFormats;
const DEFAULT_FORMAT = '4v4';
const STORE_KEY = 'pb-4v4-state-v1';
const SCORE_HINT_KEY = 'pb-score-scoring-hint-v1';
function fmt() { return F.FORMATS[S.format] || F.FORMATS[DEFAULT_FORMAT]; }

/* ===== State ===== */
function freshState(teams, format) {
  return {
    phase: 'between',        // 'setup' | 'between' | 'play' | 'done'
    format,                  // key into PBFormats.FORMATS
    teams,                   // [{name, players:[...]}, {name, players:[...]}]
    scores: [0, 0],
    round: 0,                // 0-indexed round
    matchup: 0,              // 0-indexed lane / seed within the round
    rallies: 0,              // points played in the current lane
    server: 0,               // team serving next rally (winner of last rally)
    pendingSub: false,       // play paused for a rolling sub until the user confirms
    swapped: false,          // true = team B on the left side of the screen
    overtime: false,         // golden point at 36-36 after all rounds
    note: 'Game on!',
    hist: [],                // undo stack (past states)
    future: []               // redo stack (states undone from)
  };
}
let S = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      if (st.server === undefined) st.server = 0;      // migrate pre-serve-tracking saves
      if (st.overtime === undefined) st.overtime = false;
      if (st.swapped === undefined) st.swapped = false;
      if (st.format === undefined) st.format = DEFAULT_FORMAT; // pre-format saves are 4v4
      if (st.future === undefined) st.future = [];             // pre-redo saves
      if (st.pendingSub === undefined) st.pendingSub = false;  // pre-sub-pause saves
      return st;
    }
  } catch (e) {}
  return setupState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
}
function defaultTeams() {
  return [
    { name: '', players: ['', '', '', ''] },
    { name: '', players: ['', '', '', ''] }
  ];
}
function setupState(teams, format) {
  return { phase: 'setup', teams: teams || defaultTeams(), format: format || DEFAULT_FORMAT };
}

/* ===== Game logic ===== */
function stateSnap() {
  return JSON.stringify({
    phase: S.phase, scores: S.scores, round: S.round, matchup: S.matchup,
    rallies: S.rallies, server: S.server, overtime: S.overtime, note: S.note,
    pendingSub: S.pendingSub
  });
}

function snapshot() {
  S.hist.push(stateSnap());
  if (S.hist.length > 300) S.hist.shift();
  S.future = []; // a newly scored rally invalidates anything undone
}

function undo() {
  const prev = S.hist.pop();
  if (!prev) return;
  S.future.push(stateSnap());
  Object.assign(S, JSON.parse(prev));
  render();
}

function redo() {
  const next = S.future.pop();
  if (!next) return;
  S.hist.push(stateSnap());
  Object.assign(S, JSON.parse(next));
  render();
}

function hasWinner() {
  // Golden point: at 36-36 after all rounds, the next rally wins outright.
  return F.checkWinner(fmt(), S.scores, S.overtime);
}

function point(team) {
  if (S.phase !== 'play' || S.pendingSub) return;
  hideScoreHint();
  if (navigator.vibrate) navigator.vibrate(10);
  snapshot();
  S.scores[team]++;
  S.rallies++;
  S.server = team; // rally winner serves next

  if (hasWinner() !== null) {
    if (navigator.vibrate) navigator.vibrate([20, 45, 90]);
    S.phase = 'done';
    render();
    return;
  }

  // Golden point has no rally allocation — a single rally decides it.
  if (!S.overtime && S.rallies >= fmt().laneLength[S.round]) {
    advanceMatchup();
  } else {
    // Pause play if this rally triggers a rolling substitution — the
    // announcement stays up until the user taps Continue play.
    const f = fmt();
    if (f.sub && F.onCourt(f, f.t4, S.round, S.matchup, S.rallies) !==
                 F.onCourt(f, f.t4, S.round, S.matchup, S.rallies - 1)) {
      S.pendingSub = true;
    }
  }
  pop = team; // animate the scoring side's number on the next render
  render();
}

function confirmSub() {
  S.pendingSub = false;
  render();
}

// The display number of the current matchup: global (1..9) for formats that
// count across the whole match, per-round (seed) otherwise.
function unitNum(f) {
  return f.globalCount ? S.round * f.lanesPerRound + S.matchup + 1 : S.matchup + 1;
}

function advanceMatchup() {
  const f = fmt();
  const finished = unitNum(f);
  S.rallies = 0;
  S.matchup++;
  if (S.matchup >= f.lanesPerRound) {
    S.matchup = 0;
    S.round++;
  }
  if (S.round >= F.rounds(f)) {
    // All rounds done at 36-36 — the final lane's last pairing plays golden point.
    S.overtime = true;
    S.round = F.rounds(f) - 1;
    S.matchup = f.lanesPerRound - 1;
    S.rallies = f.laneLength[S.round]; // continue the final lane into sudden death
    S.note = 'All square!';
  } else {
    const base = `${f.unit} ${displayUnitNum(f, finished)} ${f.doneWord}`;
    S.note = S.matchup === 0 ? `${base} — that wraps Round ${S.round}!` : `${base}!`;
  }
  S.phase = 'between';
}

function startPlay() {
  S.phase = 'play';
  if (!scoreHintShownThisSession) {
    let seen = false;
    try { seen = localStorage.getItem(SCORE_HINT_KEY) === '1'; } catch (e) {}
    if (!seen) {
      scoreHintVisible = true;
      scoreHintShownThisSession = true;
      try { localStorage.setItem(SCORE_HINT_KEY, '1'); } catch (e) {}
    }
  }
  render();
  if (scoreHintVisible) {
    clearTimeout(scoreHintTimer);
    scoreHintTimer = setTimeout(() => { hideScoreHint(); render(); }, 4500);
  }
}
function setServer(t) {
  if (S.server === t) return;
  S.server = t;
  suppressInterstitialAnimation = true;
  try { render(); }
  finally { suppressInterstitialAnimation = false; }
}

function startGameFromSetup() {
  captureSetupInputs();
  const f = fmt();
  const teams = [0, 1].map(t => ({
    name: (S.teams[t].name || '').trim() || (t === 0 ? 'Team A' : 'Team B'),
    players: Array.from({ length: f.teamSizes[t] }, (_, p) =>
      (S.teams[t].players[p] || '').trim() || `${t === 0 ? 'A' : 'B'}${p + 1}`)
  }));
  S = freshState(teams, S.format);
  render();
}
// Snapshot whatever's currently typed into S.teams so it survives a re-render
// (switching format, or opening the player-names section, changes the inputs shown).
function captureSetupInputs() {
  for (let t = 0; t < 2; t++) {
    const nameEl = document.getElementById(`tname${t}`);
    if (nameEl) S.teams[t].name = nameEl.value;
    for (let p = 0; p < 4; p++) {
      const el = document.getElementById(`p${t}_${p}`);
      if (el) S.teams[t].players[p] = el.value;
    }
  }
}
function pickFormat(id) {
  captureSetupInputs();   // preserve typed names across the layout change
  S.format = id;
  render();
}
function togglePlayers() {
  captureSetupInputs();   // preserve typed names across the disclosure toggle
  playersOpen = !playersOpen;
  render();
}

/* Display preference only — deliberately not snapshotted, so undo never flips sides.
   Swap is only offered on the interstitial, so animate the panel as a vertical-axis
   card flip (the natural metaphor for swapping left/right) and swap the content at
   the edge-on midpoint, so the names never appear mirrored. */
function swapSides() {
  const card = app.querySelector('.itl');
  if (S.phase === 'between' && card && card.animate) {
    if (navigator.vibrate) navigator.vibrate(15);
    swapping = true;
    const flipOut = card.animate(
      [{ transform: 'perspective(1200px) rotateY(0deg)', opacity: 1 },
       { transform: 'perspective(1200px) rotateY(90deg)', opacity: 0.45 }],
      { duration: 165, easing: 'cubic-bezier(0.45, 0, 0.9, 0.55)' }
    );
    flipOut.onfinish = () => {
      S.swapped = !S.swapped;
      render();                         // rebuilds with .itl.static (no mount rise)
      const next = app.querySelector('.itl');
      if (next && next.animate) {
        const flipIn = next.animate(
          [{ transform: 'perspective(1200px) rotateY(-90deg)', opacity: 0.45 },
           { transform: 'perspective(1200px) rotateY(0deg)', opacity: 1 }],
          { duration: 195, easing: 'cubic-bezier(0.12, 0.5, 0.2, 1)', fill: 'backwards' }
        );
        flipIn.onfinish = () => { swapping = false; };
      } else {
        swapping = false;
      }
    };
    return;
  }
  S.swapped = !S.swapped;
  render();
}

/* Ephemeral UI state — intentionally not persisted or snapshotted. */
let menuOpen = false;
let playersOpen = false;
let dialog = null;   // confirm sheet: { title, body, confirm, danger, action }
let aboutOpen = false;
let rulesOpen = false;
let swapping = false; // a side-swap flip is mid-flight (suppresses the card's mount animation)
let suppressInterstitialAnimation = false; // server toggle re-renders without replaying the overlay entrance
let pop = null;      // team index whose score should pop on the next render
let scoreHintVisible = false;
let scoreHintShownThisSession = false;
let scoreHintTimer = null;
function hideScoreHint() {
  scoreHintVisible = false;
  if (scoreHintTimer) clearTimeout(scoreHintTimer);
  scoreHintTimer = null;
}
function dismissScoreHint(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  hideScoreHint();
  render();
}
function toggleMenu() { menuOpen = !menuOpen; render(); }
function menuRedo() { menuOpen = false; redo(); }         // redo() re-renders
function openAbout() { captureSetupInputs(); menuOpen = false; aboutOpen = true; render(); }
function closeAbout() { aboutOpen = false; render(); }
function openRules() { captureSetupInputs(); rulesOpen = true; render(); }
function closeRules() { rulesOpen = false; render(); }

// Feedback launches the user's mail app pre-addressed to the project inbox;
// they write their message and send from there.
const FEEDBACK_EMAIL = 'michael.projects@icloud.com';
function sendFeedback() {
  captureSetupInputs();
  menuOpen = false;
  render();
  window.location.href = 'mailto:' + FEEDBACK_EMAIL
    + '?subject=' + encodeURIComponent('Pickleball Scores — app feedback');
}

// About sheet — shared by the game's ⋮ menu and the setup screen's footer links.
function aboutSheet() {
  return `
    <div class="sheet-backdrop" onpointerdown="closeAbout()"></div>
    <div class="sheet about">
      <img src="./icon.svg" class="about-icon" alt="">
      <div class="about-name">Pickleball Scores</div>
      <div class="about-ver">Version 1.0</div>
      <div class="about-credit">Developed by Michael Guo</div>
      <div class="about-copy">© 2026 Michael Guo</div>
      <div class="sheet-actions">
        <button class="sheet-btn accent" onclick="closeAbout()">Done</button>
      </div>
    </div>`;
}

// A win/setup already ends the game, so those resets are immediate. Mid-game
// resets from the menu route through a styled confirm sheet instead.
function doRestart(keepTeams) {
  S = keepTeams ? freshState(S.teams, S.format) : setupState(undefined, DEFAULT_FORMAT);
  playersOpen = false;
  rulesOpen = false;
  render();
}
function askRestart(keepTeams) {
  menuOpen = false;
  dialog = keepTeams
    ? { title: 'Restart game?', body: 'Scores go back to 0–0. Same teams and format.', confirm: 'Restart', danger: false, action: () => doRestart(true) }
    : { title: 'New teams?', body: 'Clears scores and player names so you can set up a new match.', confirm: 'New teams', danger: true, action: () => doRestart(false) };
  render();
}
function closeDialog() { dialog = null; render(); }
function confirmDialog() { const a = dialog && dialog.action; dialog = null; render(); if (a) a(); }

/* ===== Rendering ===== */
const app = document.getElementById('app');
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const seedName = n => `Seed ${n}`;
const displayUnitNum = (f, n = unitNum(f)) => String(n);
const BALL = s => `<svg class="ball" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#cbdc46"/><g fill="#7c8f1f"><circle cx="12" cy="7" r="1.7"/><circle cx="8" cy="11.5" r="1.7"/><circle cx="16" cy="11.5" r="1.7"/><circle cx="10" cy="16" r="1.7"/><circle cx="14.5" cy="16" r="1.7"/></g></svg>`;

// Inline SVG icon set — one visual language with the pickleball mark, no emoji.
function svgIcon(size, inner, filled) {
  const style = filled
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" ${style} aria-hidden="true">${inner}</svg>`;
}
const icons = {
  undo:   s => svgIcon(s, '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  redo:   s => svgIcon(s, '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  swap:   s => svgIcon(s, '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  sub:    s => svgIcon(s, '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  check:  s => svgIcon(s, '<polyline points="20 6 9 17 4 12"/>'),
  bolt:   s => svgIcon(s, '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', true),
  more:   s => svgIcon(s, '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', true),
  trophy: s => svgIcon(s, '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M6.8 6H4.6a2 2 0 0 0 0 4H7.2"/><path d="M17.2 6h2.2a2 2 0 0 1 0 4H16.8"/><path d="M9 21h6M12 14v7"/>'),
  info:   s => svgIcon(s, '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="7.5" x2="12.01" y2="7.5"/>'),
  mail:   s => svgIcon(s, '<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>'),
  close:  s => svgIcon(s, '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')
};

function render() {
  save();
  if (S.phase === 'setup') renderSetup();
  else renderGame();
}

function rulesOverview(f) {
  const matchupRule = f.sub ? `
      <div class="rules-team-rules">
        <div class="rules-team-rule t3">
          <span class="rules-team-tag">Team of ${f.teamSizes[f.t3]}</span>
          One seed plays each matchup from start to finish.
        </div>
        <div class="rules-team-rule t4">
          <span class="rules-team-tag">Team of ${f.teamSizes[f.t4]}</span>
          Seeds rotate to meet a round quota. Unfinished quota carries into the next round.
        </div>
      </div>` : `
      <div class="rules-peer-rule">
        Each seed plays the same-numbered seed on the other team for the full matchup.
      </div>`;
  return `
    <div class="rules-overview">
      ${matchupRule}
      <div class="rules-facts">
        <div class="rules-fact"><strong>Rally scoring</strong>Winner serves next</div>
        <div class="rules-fact"><strong>Scores carry</strong>Between matchups and rounds</div>
        <div class="rules-fact"><strong>First to ${f.target}</strong>Win by ${f.winBy}</div>
        <div class="rules-fact"><strong>36–36</strong>Final pairing plays 1 golden point</div>
      </div>
    </div>`;
}

function peerFormatRules(f) {
  const seeds = f.teamSizes[0];
  const rows = f.laneLength.map((len, round) => `
          <tr>
            <td>Round ${round + 1}</td>
            <td>Seeds 1–${seeds} play their counterparts</td>
            <td>${len} points per matchup</td>
          </tr>`).join('');
  return `
    <h2 class="rules-section-title">Round structure</h2>
    <div class="rules-table-wrap">
      <table class="rules-table">
        <thead><tr><th>Round</th><th>Matchups</th><th>Allocation</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function subRoundRules(f, round) {
  const len = f.laneLength[round];
  const rows = f.sub[round].map((segments, lane) => {
    const flow = segments.map(([seed, count], i) => {
      const stay = round < F.rounds(f) - 1 &&
                   lane === f.lanesPerRound - 1 &&
                   i === segments.length - 1
        ? ' <span class="stay-on-court">(stay on court)</span>'
        : '';
      return `<span class="rotation-segment"><span class="rules-seed t4">${seedName(seed + 1)}</span><span class="rotation-count"> · ${count}</span>${stay}</span>`;
    }).join('<span class="rotation-arrow">→</span>');
    return `
          <tr>
            <td data-label="Matchup">${lane + 1}</td>
            <td class="rules-team3-cell" data-label="Team of ${f.teamSizes[f.t3]}"><span class="rotation-flow"><span class="rules-seed t3">${seedName(lane + 1)}</span><span class="rotation-count"> · ${len}</span></span></td>
            <td class="rules-team4-cell" data-label="Team of ${f.teamSizes[f.t4]}"><span class="rotation-flow">${flow}</span></td>
          </tr>`;
  }).join('');

  return `
    <section class="rules-round">
      <div class="rules-round-head">
        <h3 class="rules-round-label">Round ${round + 1}</h3>
        <div class="rules-round-alloc">
          <span class="rules-allocation t3">Team of ${f.teamSizes[f.t3]} · ${len} points each</span>
          <span class="rules-allocation t4">Team of ${f.teamSizes[f.t4]} · ${f.t4Quota[round]} point quota each</span>
        </div>
      </div>
      <div class="rules-table-wrap">
        <table class="rules-table sub-rules-table">
          <thead><tr><th>Matchup</th><th class="rules-team3-head">Team of ${f.teamSizes[f.t3]}</th><th class="rules-team4-head">Team of ${f.teamSizes[f.t4]}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function subFormatRules(f) {
  return `
    <h2 class="rules-section-title">Round structure</h2>
    ${Array.from({ length: F.rounds(f) }, (_, round) => subRoundRules(f, round)).join('')}
    <div class="rules-callout peer">The app shows each upcoming matchup and announces substitutions automatically.</div>`;
}

function rulesOverlay(f) {
  return `
    <div class="rules-backdrop" onpointerdown="closeRules()"></div>
    <div class="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <div class="rules-head">
        <div class="rules-head-text">
          <div class="rules-title" id="rules-title">${esc(f.name)} rules</div>
          <div class="rules-subtitle">${esc(f.blurb)}</div>
        </div>
        <button class="rules-close" onclick="closeRules()" aria-label="Close rules">${icons.close(22)}</button>
      </div>
      <div class="rules-scroll">
        ${rulesOverview(f)}
        ${f.sub ? subFormatRules(f) : peerFormatRules(f)}
      </div>
    </div>`;
}

function renderSetup() {
  const t = S.teams;
  const f = fmt();
  const asymmetric = f.teamSizes[0] !== f.teamSizes[1];
  const seg = Object.values(F.FORMATS).map(ff => `
        <button class="seg ${ff.id === S.format ? 'on' : ''}" onclick="pickFormat('${ff.id}')">${ff.id}</button>`).join('');
  // The caption drawer lists the format as label/value facts. Team labels in
  // the sub format take the team colors, echoing the cards and rules modal.
  const fact = (lbl, val, cls) => `<span class="fmt-lbl${cls ? ' ' + cls : ''}">${lbl}</span><span class="fmt-val">${val}</span>`;
  const facts = f.sub
    ? fact('Rounds', F.rounds(f))
      + fact(`Team of ${f.teamSizes[f.t3]}`, `${f.laneLength.join('→')}&nbsp;points per&nbsp;matchup`, 't3')
      + fact(`Team of ${f.teamSizes[f.t4]}`, `${f.t4Quota.join('→')}&nbsp;points per&nbsp;matchup`, 't4')
      + fact('Subs', 'Rolling')
    : fact('Rounds', F.rounds(f))
      + fact('Points', `${f.laneLength.join('→')} per&nbsp;matchup`)
      + fact('Matchups', 'Seeds play their counterpart');
  const card = (ti, cls, label) => {
    const size = f.teamSizes[ti];
    const players = playersOpen ? Array.from({ length: size }, (_, p) => `
        <input class="row-input" id="p${ti}_${p}" placeholder="Player ${p + 1}" value="${esc(t[ti].players[p] || '')}" autocomplete="off" aria-label="${label} player ${p + 1}">`).join('') : '';
    return `
      <div class="team-card ${cls}">
        <input class="row-input head" id="tname${ti}" placeholder="${label}" value="${esc(t[ti].name || '')}" autocomplete="off" aria-label="${label} name">
        ${asymmetric ? `<div class="team-size">Fields ${size} players</div>` : ''}
        ${players}
      </div>`;
  };
  app.innerHTML = `
    <div class="setup">
      <div class="setup-scroll">
        <h1><img src="./icon.svg" class="title-icon" alt=""> Pickleball Scores</h1>
        <div class="seg-ctrl">${seg}</div>
        <div class="fmt-caption">
          <div class="fmt-facts">${facts}</div>
          <button class="fmt-info-btn" onclick="openRules()" aria-label="View detailed ${f.id} rules" title="View detailed rules">${icons.info(15)} Rules</button>
        </div>
        <button class="disclosure" onclick="togglePlayers()">${playersOpen ? 'Hide player names' : 'Add player names'}</button>
        <div class="team-cards">
          ${card(0, 'a', 'Team A')}
          ${card(1, 'b', 'Team B')}
        </div>
      </div>
      <div class="setup-footer">
        <button class="start-btn" onclick="startGameFromSetup()">Start game</button>
        <div class="setup-links">
          <button onclick="sendFeedback()">Send feedback</button>
          <span aria-hidden="true">·</span>
          <button onclick="openAbout()">About</button>
        </div>
      </div>
    </div>
    ${rulesOpen ? rulesOverlay(f) : ''}
    ${aboutOpen ? aboutSheet() : ''}`;
}

function sideOrder() { return S.swapped ? [1, 0] : [0, 1]; }

// Rolling-sub countdown for the team of 4 (3v4 only): who subs on next and
// when. '' once the player on court is the last one in this matchup.
function subLine(f, t) {
  if (f.id !== '3v4' || t !== f.t4 || S.overtime) return '';
  const ns = F.nextSub(f, S.round, S.matchup, S.rallies);
  if (!ns) return '';
  return `<div class="subline">${esc(S.teams[t].players[ns.seed])} subs ${ns.inPoints === 1 ? 'next point' : `in ${ns.inPoints}`}</div>`;
}

function zoneHTML(t) {
  const f = fmt();
  const p = S.teams[t].players[F.onCourt(f, t, S.round, S.matchup, S.rallies)];
  const isSub = f.sub && t === f.t4;
  const sub = subLine(f, t);
  // Both columns get the same rows so the team headers line up: when only the
  // team of 4 has a sub countdown, the other side gets an invisible spacer.
  const subRow = sub || (subLine(f, 1 - t) ? '<div class="subline ghost">&nbsp;</div>' : '');
  // Only rotating formats need the "on court" qualifier; elsewhere the seed
  // plays the whole matchup, so the bare name is enough.
  const pname = isSub ? `${esc(p)} <span class="pq">on court</span>` : esc(p);
  return `
      <div class="zone ${t === 0 ? 'a' : 'b'}" onclick="point(${t})">
        <div class="tname">${esc(S.teams[t].name)}</div>
        <div class="pname">${pname}</div>
        <div class="score">${S.scores[t]}</div>
        ${subRow}
        <div class="serve-pill ${S.server === t ? '' : 'hidden'}">${BALL(14)} Serving</div>
      </div>`;
}

// Blocking substitution announcement (3v4). Rendered at the stage level so it
// spans the whole play area — scoring is paused (point() ignores taps) until
// Continue play is tapped.
function subOverlay() {
  const f = fmt();
  const t = f.t4;
  const onNow = S.teams[t].players[F.onCourt(f, t, S.round, S.matchup, S.rallies)];
  const prev = S.teams[t].players[F.onCourt(f, t, S.round, S.matchup, S.rallies - 1)];
  return `
      <div class="sub-panel">
        <div class="sub-card">
          <div class="sub-icon">${icons.sub(36)}</div>
          <div class="sub-who">${esc(onNow)} subs on now</div>
          <div class="sub-for">taking over from ${esc(prev)}</div>
          <button class="sub-go" onclick="confirmSub()">Continue play</button>
        </div>
      </div>`;
}

function renderGame() {
  const f = fmt();
  const [L, R] = sideOrder();
  const len = f.laneLength[S.round];
  const is34 = f.id === '3v4';
  const pt = Math.min(S.rallies + 1, len);
  const roundLabel = S.overtime ? 'Golden point' : `Round ${S.round + 1}/${F.rounds(f)}`;
  const rallyLabel = S.overtime
    ? 'Next rally wins it all'
    : `${f.unit} ${displayUnitNum(f)} · ${is34 ? 'Point' : 'Rally'} ${pt}/${len}`;
  app.innerHTML = `
    <div class="topbar">
      <div class="tb-side">
        <button class="tb-btn" onclick="undo()" ${S.hist.length ? '' : 'disabled'} title="Undo" aria-label="Undo">${icons.undo(22)}</button>
      </div>
      <div class="tb-center">
        <div class="round-line">${roundLabel}</div>
        ${S.phase === 'play' ? `<div class="rally-line">${rallyLabel}</div>` : ''}
      </div>
      <div class="tb-side right">
        <button class="tb-btn" onclick="toggleMenu()" title="More options" aria-label="More options">${icons.more(22)}</button>
      </div>
    </div>
    <div class="stage">
      <div class="zones${is34 ? ' has-subs' : ''}">
        ${zoneHTML(L)}
        ${zoneHTML(R)}
      </div>
      ${scoreHintVisible ? `
      <div class="scoring-hint">
        <div class="scoring-hint-copy" role="status" aria-live="polite">Tap the team that won the rally.</div>
        <button class="scoring-hint-close" onclick="dismissScoreHint(event)" aria-label="Dismiss scoring hint">${icons.close(18)}</button>
      </div>` : ''}
      ${S.pendingSub ? subOverlay() : ''}
      ${S.phase === 'between' ? interstitial() : ''}
      ${S.phase === 'done' ? winnerOverlay() : ''}
    </div>
    ${menuOpen ? `
    <div class="menu-backdrop" onpointerdown="toggleMenu()"></div>
    <div class="menu">
      ${S.future.length ? `<button onclick="menuRedo()">${icons.redo(18)} Redo</button><div class="menu-sep"></div>` : ''}
      <button onclick="askRestart(true)">Restart game</button>
      <button class="danger" onclick="askRestart(false)">New teams</button>
      <div class="menu-sep"></div>
      <button onclick="sendFeedback()">${icons.mail(18)} Send feedback</button>
      <button onclick="openAbout()">${icons.info(18)} About</button>
    </div>` : ''}
    ${dialog ? `
    <div class="sheet-backdrop" onpointerdown="closeDialog()"></div>
    <div class="sheet">
      <div class="sheet-title">${esc(dialog.title)}</div>
      <div class="sheet-body">${esc(dialog.body)}</div>
      <div class="sheet-actions">
        <button class="sheet-btn ${dialog.danger ? 'danger' : 'accent'}" onclick="confirmDialog()">${esc(dialog.confirm)}</button>
        <button class="sheet-btn ghost" onclick="closeDialog()">Cancel</button>
      </div>
    </div>` : ''}
    ${aboutOpen ? aboutSheet() : ''}`;

  // Pop the number that just changed. Runs after the DOM is rebuilt; harmless
  // when the zone sits behind an overlay (not visible) or has advanced away.
  if (pop !== null) {
    const el = app.querySelector('.zone.' + (pop === 0 ? 'a' : 'b') + ' .score');
    if (el && el.animate) {
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' });
    }
    pop = null;
  }
}

function interstitial() {
  const f = fmt();
  const seed = S.matchup;
  const [L, R] = sideOrder();
  const cls = t => t === 0 ? 'a' : 'b';
  // The players on court for the upcoming rally (for 3v4 the team of 4 rotates,
  // so ask the schedule). Between lanes rallies is 0 (the lane's openers); in
  // the golden point rallies sits at the lane end, so this keeps the pair that
  // finished regulation rather than resetting to the lane's first server.
  const lanePlayer = t => S.teams[t].players[F.onCourt(f, t, S.round, seed, S.rallies)];
  const pL = lanePlayer(L);
  const pR = lanePlayer(R);
  const len = f.laneLength[S.round];
  const lanesPer = f.lanesPerRound;
  const done = S.round * lanesPer + S.matchup;
  const total = F.rounds(f) * lanesPer;
  const atStart = S.scores[0] + S.scores[1] === 0;
  const srv = S.server;
  const is34 = f.id === '3v4';
  // Teams change ends between rounds, so only offer swap-sides at a round
  // boundary (the first matchup of a round — which includes the game's start).
  const canSwap = !S.overtime && S.matchup === 0;

  const side = t => `
        <div class="${S.scores[t] < S.scores[1 - t] ? 'trail' : ''}">
          <div class="lbl ${cls(t)}">${esc(S.teams[t].name)}</div>
          <div class="num">${S.scores[t]}</div>
        </div>`;
  const progress = S.overtime ? '' : `
        <div class="progress">
          <div class="segs">${Array.from({ length: total }, (_, i) =>
            `<div class="seg-bar ${i < done ? 'done' : i === done ? 'next' : ''}"></div>`).join('')}</div>
          <div class="cap">${f.progressWord} ${done + 1} of ${total}</div>
        </div>`;
  // Team-of-4 rotation for the upcoming lane (3v4 only).
  const plan = (is34 && !S.overtime) ? F.laneSubPlan(f, S.round, seed) : null;
  const subplan = plan ? `
          <div class="subplan">
            <span class="sp-lbl">${esc(S.teams[f.t4].name)} subs</span>
            <span class="sp-flow">${plan.map(seg => {
              const range = seg.from === seg.to ? `${seg.from}` : `${seg.from}–${seg.to}`;
              return `<span class="sp-seg"><b>${esc(S.teams[f.t4].players[seg.seed])}</b> <span class="sp-pts">${range}</span></span>`;
            }).join('<span class="sp-arrow">→</span>')}</span>
          </div>` : '';
  // Serve is only a choice before the game's first rally; afterwards the rally
  // winner serves — shown as the ball next to their name in the vs row.
  const serveArea = atStart ? `
        <div class="serve-pick">
          <span class="lbl">First serve</span>
          <div class="svc">
            <button class="${srv === L ? `on ${cls(L)}` : ''}" onclick="setServer(${L})">${srv === L ? BALL(14) : ''}${esc(pL)}</button>
            <button class="${srv === R ? `on ${cls(R)}` : ''}" onclick="setServer(${R})">${srv === R ? BALL(14) : ''}${esc(pR)}</button>
          </div>
        </div>` : '';
  const vsName = (t, name) => `<span class="p ${cls(t)}">${!atStart && srv === t ? BALL(22) : ''}${esc(name)}</span>`;
  // Status is stated once in the eyebrow and once in the progress caption; the
  // card just names what's up next.
  const eyebrowIcon = S.overtime ? icons.bolt(15) : atStart ? BALL(13) : icons.check(15);
  const staticMount = swapping || suppressInterstitialAnimation;

  return `
    <div class="overlay${staticMount ? ' static' : ''}">
      <div class="itl${staticMount ? ' static' : ''}">
        <div class="itl-status">
          <div class="eyebrow${S.overtime ? ' gold' : ''}">${eyebrowIcon} ${esc(S.note)}</div>
          <div class="scoreboard">${side(L)}<div class="dash">—</div>${side(R)}</div>
          ${progress}
        </div>
        <div class="itl-card">
          <div class="chiprow">
            <span class="chip${S.overtime ? ' gold' : ''}">${S.overtime ? 'Golden point' : 'Up next'}</span>
          </div>
          <div class="vs">${vsName(L, pL)}<span class="v">vs</span>${vsName(R, pR)}</div>
          <div class="alloc">${S.overtime ? 'Sudden death — one rally wins it all' : (is34 ? `${len} points this matchup` : `${len} rallies this matchup`)}</div>
          ${subplan}
          ${serveArea}
        </div>
        <div class="itl-actions${canSwap ? '' : ' solo'}">
          ${canSwap ? `<button class="itl-ghost wide" onclick="swapSides()">${icons.swap(18)} Swap sides</button>` : ''}
          <button class="itl-primary" onclick="startPlay()">${S.overtime ? 'Play golden point' : 'Start rallies'}</button>
        </div>
      </div>
    </div>`;
}

function winnerOverlay() {
  const w = hasWinner();
  const [L, R] = sideOrder();
  return `
    <div class="overlay">
      <div class="win">
        <div class="trophy">${icons.trophy(64)}</div>
        <div class="win-team" style="color:${w === 0 ? 'var(--teamA)' : 'var(--teamB)'}">${esc(S.teams[w].name)} wins</div>
        <div class="scoreline"><b>${S.scores[L]}</b> — <b>${S.scores[R]}</b></div>
        <div class="itl-actions">
          <button class="itl-primary" onclick="doRestart(true)">Rematch</button>
          <button class="itl-ghost wide" onclick="doRestart(false)">New teams</button>
        </div>
      </div>
    </div>`;
}

/* ===== Keep screen awake during play ===== */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});
document.addEventListener('pointerdown', keepAwake, { once: true });

/* ===== PWA ===== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

render();
