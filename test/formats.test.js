'use strict';

/* Unit tests for the pure match-format logic in formats.js.
   Run with `npm test` (node --test) — no dependencies. */

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../formats.js');

const f3 = F.FORMATS['3v4'];
const f4 = F.FORMATS['4v4'];
const f33 = F.FORMATS['3v3'];

/* Walk every point of a match through onCourt() and tally how many points each
   player of `team` plays. Returns an array indexed by seed. This exercises the
   same resolver the app uses, so a mistranscribed schedule shows up here. */
function playedCounts(fmt, team) {
  const counts = new Array(fmt.teamSizes[team]).fill(0);
  for (let round = 0; round < F.rounds(fmt); round++) {
    for (let lane = 0; lane < fmt.lanesPerRound; lane++) {
      for (let p = 0; p < F.laneLength(fmt, round); p++) {
        counts[F.onCourt(fmt, team, round, lane, p)]++;
      }
    }
  }
  return counts;
}

test('3v4: total pool is 72 points (30 + 24 + 18)', () => {
  assert.equal(F.totalPool(f3), 72);
  assert.equal(F.totalPool(f3), 30 + 24 + 18);
});

test('3v4: every team-of-3 player plays 24 points (10 + 8 + 6)', () => {
  const counts = playedCounts(f3, f3.t3);
  assert.deepEqual(counts, [24, 24, 24]);
});

test('3v4: every team-of-4 player plays 18 points across the match', () => {
  const counts = playedCounts(f3, f3.t4);
  assert.deepEqual(counts, [18, 18, 18, 18]);
});

test('3v4: each lane\'s team-of-4 segments sum exactly to the lane length', () => {
  for (let round = 0; round < F.rounds(f3); round++) {
    const len = F.laneLength(f3, round);
    for (let lane = 0; lane < f3.lanesPerRound; lane++) {
      const sum = f3.sub[round][lane].reduce((s, [, count]) => s + count, 0);
      assert.equal(sum, len, `round ${round} lane ${lane} should sum to ${len}`);
    }
  }
});

test('3v4: after the final lane no team-of-4 player has outstanding quota', () => {
  // Total quota over the match equals the sum of per-round quotas (8+6+4 = 18).
  const totalQuota = f3.t4Quota.reduce((s, q) => s + q, 0);
  assert.equal(totalQuota, 18);
  // Every player has played exactly that much — nothing owed, nothing over.
  for (const played of playedCounts(f3, f3.t4)) assert.equal(played, totalQuota);
});

test('3v4: substitutions never skip a seed within a lane', () => {
  // Each segment boundary hands off to the next player who takes over cleanly:
  // walking point-by-point, the on-court seed only ever changes at a boundary.
  for (let round = 0; round < F.rounds(f3); round++) {
    for (let lane = 0; lane < f3.lanesPerRound; lane++) {
      const len = F.laneLength(f3, round);
      for (let p = 1; p < len; p++) {
        const prev = F.onCourt(f3, f3.t4, round, lane, p - 1);
        const now = F.onCourt(f3, f3.t4, round, lane, p);
        const boundary = F.nextSub(f3, round, lane, p - 1);
        const changed = prev !== now;
        assert.equal(changed, !!(boundary && boundary.inPoints === 1),
          `round ${round} lane ${lane} point ${p}: sub flag and boundary disagree`);
        if (changed) assert.equal(now, boundary.seed);
      }
    }
  }
});

test('3v4: the golden point continues the final lane (T3 s3 vs T4 s4)', () => {
  const lastRound = F.rounds(f3) - 1;    // 2
  const lastLane = f3.lanesPerRound - 1; // 2
  const past = F.laneLength(f3, lastRound); // clamp beyond the lane end
  assert.equal(F.onCourt(f3, f3.t3, lastRound, lastLane, past), 2); // T3 seed 3
  assert.equal(F.onCourt(f3, f3.t4, lastRound, lastLane, past), 3); // T4 seed 4
});

test('win conditions: first to 33, win by 2', () => {
  assert.equal(F.checkWinner(f3, [33, 31], false), 0);
  assert.equal(F.checkWinner(f3, [31, 33], false), 1);
  assert.equal(F.checkWinner(f3, [33, 32], false), null); // only 1 ahead
  assert.equal(F.checkWinner(f3, [32, 30], false), null); // not yet to target
  assert.equal(F.checkWinner(f3, [35, 33], false), 0);
});

test('win conditions: golden point at 36-36 is sudden death (win by 1)', () => {
  assert.equal(F.checkWinner(f3, [36, 36], true), null);
  assert.equal(F.checkWinner(f3, [37, 36], true), 0);
  assert.equal(F.checkWinner(f3, [36, 37], true), 1);
});

test('4v4 stays a peer format: 72-point pool, seed plays its counterpart', () => {
  assert.equal(F.totalPool(f4), 72);
  // In 4v4 both teams field the seed equal to the lane, every point.
  for (let round = 0; round < F.rounds(f4); round++) {
    for (let lane = 0; lane < f4.lanesPerRound; lane++) {
      assert.equal(F.onCourt(f4, 0, round, lane, 3), lane);
      assert.equal(F.onCourt(f4, 1, round, lane, 3), lane);
    }
  }
  assert.equal(F.checkWinner(f4, [33, 30], false), 0);
});

test('3v3: total pool is 72 points (30 + 24 + 18)', () => {
  assert.equal(F.totalPool(f33), 72);
  assert.equal(F.totalPool(f33), 30 + 24 + 18);
});

test('3v3: every player plays 24 points (10 + 8 + 6), same as its counterpart', () => {
  // Each seed plays the whole lane equal to its index in every round: 10+8+6.
  assert.deepEqual(playedCounts(f33, 0), [24, 24, 24]);
  assert.deepEqual(playedCounts(f33, 1), [24, 24, 24]);
});

test('3v3 is a peer format like 4v4: seed vs counterpart, no subs', () => {
  assert.equal(f33.sub, undefined);
  // Both teams field the seed equal to the lane for every point of every lane.
  for (let round = 0; round < F.rounds(f33); round++) {
    const len = F.laneLength(f33, round);
    for (let lane = 0; lane < f33.lanesPerRound; lane++) {
      for (let p = 0; p < len; p++) {
        assert.equal(F.onCourt(f33, 0, round, lane, p), lane);
        assert.equal(F.onCourt(f33, 1, round, lane, p), lane);
      }
    }
  }
  // Shared win conditions carry over unchanged: first to 33, win by 2.
  assert.equal(F.checkWinner(f33, [33, 30], false), 0);
  assert.equal(F.checkWinner(f33, [33, 32], false), null);
  assert.equal(F.checkWinner(f33, [37, 36], true), 0);
});
