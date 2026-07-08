/* ===========================================================================
   Match-format definitions and pure rules logic.

   Shared by two callers with no build step between them:
     - index.html loads this as a classic <script> (reads window.PBFormats)
     - test/formats.test.js require()s it in Node

   Everything here is pure: no DOM, no app state, no side effects. The engine
   in index.html owns the mutable game state and calls into these helpers.
   =========================================================================== */
(function (global) {
  'use strict';

  /* --- 3v4 "Jake": team-of-4 substitution schedule (hardcoded, deterministic).
     Indexed [round][lane] -> ordered list of [t4SeedIndex, pointCount] segments.
     Rounds, lanes and seeds are all 0-indexed. Each lane's segment counts sum
     to that lane's length. The team of 3 always fields the seed equal to the
     lane, start to finish, so only the rotating team of 4 needs a table. --- */
  const SUB_3V4 = [
    // Round 1 — lanes of 10
    [ [[0, 8], [1, 2]], [[1, 6], [2, 4]], [[2, 4], [3, 6]] ],
    // Round 2 — lanes of 8
    [ [[3, 2], [0, 6]], [[1, 6], [2, 2]], [[2, 4], [3, 4]] ],
    // Round 3 — lanes of 6
    [ [[3, 2], [0, 4]], [[1, 4], [2, 2]], [[2, 2], [3, 4]] ]
  ];

  const FORMATS = {
    '4v4': {
      id: '4v4',
      name: '4v4 Team Singles',
      blurb: 'Two teams of 4 · seeds play their counterpart',
      teamSizes: [4, 4],
      unit: 'Seed',            // noun for a within-round matchup
      doneWord: 'matchup complete',
      progressWord: 'Matchup',
      lanesPerRound: 4,
      laneLength: [8, 6, 4],   // points contested per matchup, by round
      target: 33,
      winBy: 2,
      rules:
        '3 rounds &middot; seeds play their counterparts each round<br>' +
        'Round 1: 8 rallies per matchup &middot; Round 2: 6 &middot; Round 3: 4<br>' +
        'Team scores carry over between rounds'
    },
    '3v3': {
      id: '3v3',
      name: '3v3 Team Singles',
      blurb: 'Two teams of 3 · seeds play their counterpart',
      teamSizes: [3, 3],
      unit: 'Seed',            // noun for a within-round matchup
      doneWord: 'matchup complete',
      progressWord: 'Matchup',
      lanesPerRound: 3,
      laneLength: [10, 8, 6],  // points contested per matchup, by round
      target: 33,
      winBy: 2,
      rules:
        '3 rounds &middot; seeds play their counterparts each round<br>' +
        'Round 1: 10 rallies per matchup &middot; Round 2: 8 &middot; Round 3: 6<br>' +
        'Team scores carry over between rounds'
    },
    '3v4': {
      id: '3v4',
      name: '3v4 Jake',
      blurb: 'Team of 3 vs team of 4 · rolling subs',
      teamSizes: [3, 4],
      unit: 'Matchup',
      doneWord: 'complete',
      progressWord: 'Matchup',
      globalCount: true,       // number matchups 1-9 across the match, not per round
      lanesPerRound: 3,
      laneLength: [10, 8, 6],
      target: 33,
      winBy: 2,
      t3: 0,                   // team index that fields 3 players (whole lane each)
      t4: 1,                   // team index that fields 4 players (rotates mid-lane)
      t4Quota: [8, 6, 4],      // per-round quota that generates the schedule
      sub: SUB_3V4,
      rules:
        'Team of 3 vs team of 4 &middot; 3 rounds of 3 matchups<br>' +
        'Matchups of 10 &rarr; 8 &rarr; 6 points &middot; the team of 4 subs on a rolling quota<br>' +
        'Team scores carry over &middot; first to 33, win by 2'
    }
  };

  const rounds = fmt => fmt.laneLength.length;
  const laneLength = (fmt, round) => fmt.laneLength[round];

  // Total points contested across the whole match (all lanes, all rounds).
  const totalPool = fmt =>
    fmt.laneLength.reduce((sum, len) => sum + len * fmt.lanesPerRound, 0);

  /* Which player index of `team` is on court for the point after `pointsPlayed`
     points have been completed in the given lane. For the team of 3 (and both
     teams in 4v4) the seed equal to the lane plays the whole lane. For the team
     of 4, walk the lane's segments. Past the lane end (golden point) the final
     segment continues, so the sudden-death rally keeps the last server config. */
  function onCourt(fmt, team, round, lane, pointsPlayed) {
    if (!fmt.sub || team === fmt.t3) return lane;
    const segs = fmt.sub[round][lane];
    const n = Math.min(pointsPlayed, laneLength(fmt, round) - 1); // 0-indexed point
    let acc = 0;
    for (const [seed, count] of segs) {
      acc += count;
      if (n < acc) return seed;
    }
    return segs[segs.length - 1][0];
  }

  /* The next team-of-4 substitution in this lane, or null if the player on
     court finishes it. inPoints = rallies until the incoming seed takes over. */
  function nextSub(fmt, round, lane, pointsPlayed) {
    if (!fmt.sub) return null;
    const segs = fmt.sub[round][lane];
    let acc = 0;
    for (let i = 0; i < segs.length - 1; i++) {
      acc += segs[i][1];
      if (pointsPlayed < acc) {
        return { seed: segs[i + 1][0], atPoint: acc + 1, inPoints: acc - pointsPlayed };
      }
    }
    return null;
  }

  // The full team-of-4 rotation for a lane, as [{seed, from, to}] (1-indexed
  // point ranges). Null for formats without substitutions. For the interstitial.
  function laneSubPlan(fmt, round, lane) {
    if (!fmt.sub) return null;
    let start = 1;
    return fmt.sub[round][lane].map(([seed, count]) => {
      const seg = { seed, from: start, to: start + count - 1 };
      start += count;
      return seg;
    });
  }

  const pointsLeftInLane = (fmt, round, lane, pointsPlayed) =>
    Math.max(0, laneLength(fmt, round) - pointsPlayed);

  // Winner given cumulative scores, or null. overtime => golden point (win by 1).
  function checkWinner(fmt, scores, overtime) {
    const [a, b] = scores;
    const winBy = overtime ? 1 : fmt.winBy;
    if (a >= fmt.target && a - b >= winBy) return 0;
    if (b >= fmt.target && b - a >= winBy) return 1;
    return null;
  }

  const api = {
    FORMATS, SUB_3V4,
    rounds, laneLength, totalPool,
    onCourt, nextSub, laneSubPlan, pointsLeftInLane, checkWinner
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PBFormats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
