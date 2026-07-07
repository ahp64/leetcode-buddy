import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, isFrozen } from '../lib/streak.js';
import {
  dayKey,
  prevDayKey,
  addDays,
  tzNow,
  isValidTimeZone,
} from '../lib/time.js';

test('prevDayKey handles month and year boundaries', () => {
  assert.equal(prevDayKey('2026-07-01'), '2026-06-30');
  assert.equal(prevDayKey('2026-01-01'), '2025-12-31');
  assert.equal(prevDayKey('2024-03-01'), '2024-02-29'); // leap year
});

test('dayKey respects timezone day boundaries', () => {
  // 2026-07-02 03:00 UTC is still 2026-07-01 in Chicago
  const d = new Date('2026-07-02T03:00:00Z');
  assert.equal(dayKey(d, 'UTC'), '2026-07-02');
  assert.equal(dayKey(d, 'America/Chicago'), '2026-07-01');
});

test('tzNow returns sane values', () => {
  const now = tzNow('America/Chicago');
  assert.match(now.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(now.hour >= 0 && now.hour <= 23);
  assert.ok(now.minute >= 0 && now.minute <= 59);
});

test('isValidTimeZone', () => {
  assert.ok(isValidTimeZone('America/Chicago'));
  assert.ok(!isValidTimeZone('Mars/Olympus_Mons'));
});

test('streak counts consecutive complete days plus today when complete', () => {
  const history = {
    '2026-06-29': { complete: true },
    '2026-06-30': { complete: true },
    '2026-07-01': { complete: true },
  };
  assert.deepEqual(computeStreak(history, '2026-07-02', true), {
    streak: 4,
    atRisk: false,
  });
});

test('incomplete today keeps the streak but flags it at risk', () => {
  const history = {
    '2026-06-30': { complete: true },
    '2026-07-01': { complete: true },
  };
  assert.deepEqual(computeStreak(history, '2026-07-02', false), {
    streak: 2,
    atRisk: true,
  });
});

test('one member missing a past day kills the streak for everyone', () => {
  const history = {
    '2026-06-29': { complete: true },
    '2026-06-30': { complete: false }, // buddy slacked
    '2026-07-01': { complete: true },
  };
  assert.deepEqual(computeStreak(history, '2026-07-02', true), {
    streak: 2, // only July 1 + today survive
    atRisk: false,
  });
});

test('no history and nothing solved today = no streak, not at risk', () => {
  assert.deepEqual(computeStreak({}, '2026-07-02', false), {
    streak: 0,
    atRisk: false,
  });
});

test('fresh start: everyone solved today starts streak at 1', () => {
  assert.deepEqual(computeStreak({}, '2026-07-02', true), {
    streak: 1,
    atRisk: false,
  });
});

test('addDays crosses boundaries in both directions', () => {
  assert.equal(addDays('2026-07-02', 3), '2026-07-05');
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
  assert.equal(addDays('2026-07-02', -2), '2026-06-30');
});

test('isFrozen covers the inclusive range only', () => {
  const freeze = { from: '2026-07-03', until: '2026-07-05' };
  assert.ok(!isFrozen(freeze, '2026-07-02'));
  assert.ok(isFrozen(freeze, '2026-07-03'));
  assert.ok(isFrozen(freeze, '2026-07-05'));
  assert.ok(!isFrozen(freeze, '2026-07-06'));
  assert.ok(!isFrozen(null, '2026-07-04'));
});

test('frozen days preserve the streak across a gap without growing it', () => {
  const history = {
    '2026-07-01': { complete: true },
    '2026-07-02': { complete: true },
    // July 3–4 frozen: nobody solved, no records that count
    '2026-07-03': { complete: false },
    '2026-07-04': { complete: false },
  };
  const freeze = { from: '2026-07-03', until: '2026-07-04' };
  assert.deepEqual(computeStreak(history, '2026-07-05', true, freeze), {
    streak: 3, // Jul 1, Jul 2, and today — frozen days skipped, not counted
    atRisk: false,
  });
});

test('a frozen today is never at risk and does not need solves', () => {
  const history = {
    '2026-07-01': { complete: true },
    '2026-07-02': { complete: true },
  };
  const freeze = { from: '2026-07-03', until: '2026-07-04' };
  assert.deepEqual(computeStreak(history, '2026-07-03', false, freeze), {
    streak: 2,
    atRisk: false,
  });
});

test('solving during a frozen day does not inflate the streak', () => {
  const history = {
    '2026-07-02': { complete: true },
    '2026-07-03': { complete: true }, // solved anyway while frozen
  };
  const freeze = { from: '2026-07-03', until: '2026-07-03' };
  assert.deepEqual(computeStreak(history, '2026-07-04', true, freeze), {
    streak: 2, // Jul 2 + today; the frozen Jul 3 is skipped
    atRisk: false,
  });
});

test('a miss before the freeze still kills the streak', () => {
  const history = {
    '2026-07-01': { complete: true },
    '2026-07-02': { complete: false }, // missed, then froze too late
  };
  const freeze = { from: '2026-07-03', until: '2026-07-04' };
  assert.deepEqual(computeStreak(history, '2026-07-05', true, freeze), {
    streak: 1, // only today
    atRisk: false,
  });
});
