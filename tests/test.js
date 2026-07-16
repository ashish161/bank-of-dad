// Unit tests for the Bank of Dad pure engine.
// Zero-dependency: uses a tiny assert harness so it can run under `node test.js`
// and also be driven by Stryker for mutation testing.
const E = require('./engine.gen.js');

let passed = 0, failed = 0;
const failures = [];

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; failures.push(`${msg}\n    expected ${e}\n    got      ${a}`); }
}
function approx(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) <= tol) { passed++; }
  else { failed++; failures.push(`${msg}\n    expected ~${expected} (±${tol})\n    got      ${actual}`); }
}
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; failures.push(msg); }
}

// Reset engine settings before each group
function resetState(over = {}) {
  E.__setState({ settings: Object.assign({ currency: '₹', base: 100, rate: 10, frequency: 'daily' }, over) });
}

const DAY = 24 * 3600 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;
const yearsAgoISO = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().split('T')[0]; };

// ─────────────────────────────────────────────────────────── ageGroupFor
resetState();
eq(E.ageGroupFor(5), '5-8', 'ageGroupFor: 5 -> 5-8');
eq(E.ageGroupFor(8), '5-8', 'ageGroupFor: 8 -> 5-8');
eq(E.ageGroupFor(9), '9-12', 'ageGroupFor: 9 -> 9-12 (boundary)');
eq(E.ageGroupFor(12), '9-12', 'ageGroupFor: 12 -> 9-12');
eq(E.ageGroupFor(13), '13+', 'ageGroupFor: 13 -> 13+ (boundary)');
eq(E.ageGroupFor(99), '13+', 'ageGroupFor: 99 -> 13+');
eq(E.ageGroupFor(0), '5-8', 'ageGroupFor: 0 -> 5-8');

// ─────────────────────────────────────────────────────────── tierFor
eq(E.tierFor(6), 'young', 'tierFor: 6 -> young');
eq(E.tierFor(7), 'mid', 'tierFor: 7 -> mid (boundary)');
eq(E.tierFor(12), 'mid', 'tierFor: 12 -> mid');
eq(E.tierFor(13), 'teen', 'tierFor: 13 -> teen (boundary)');

// ─────────────────────────────────────────────────────────── weeklyAllowanceFor
eq(E.weeklyAllowanceFor(100, 0), 100, 'weeklyAllowance: base 100, age 0 -> 100');
eq(E.weeklyAllowanceFor(100, 9), 1000, 'weeklyAllowance: base 100, age 9 -> 1000');
eq(E.weeklyAllowanceFor(150, 4), 750, 'weeklyAllowance: base 150, age 4 -> 750');
eq(E.weeklyAllowanceFor(0, 5), 600, 'weeklyAllowance: base 0 falls back to 100 -> 600');
eq(E.weeklyAllowanceFor(-50, 5), 600, 'weeklyAllowance: negative base falls back to 100');

// ─────────────────────────────────────────────────────────── completedYears
eq(E.completedYears(yearsAgoISO(14)), 14, 'completedYears: 14y ago -> 14');
eq(E.completedYears(yearsAgoISO(0)), 0, 'completedYears: born today -> 0');
{
  // Birthday tomorrow => age not yet incremented
  const d = new Date(); d.setFullYear(d.getFullYear() - 10); d.setDate(d.getDate() + 1);
  eq(E.completedYears(d.toISOString().split('T')[0]), 9, 'completedYears: birthday tomorrow -> one less');
}
eq(E.completedYears(yearsAgoISO(-5)), 0, 'completedYears: future birthdate clamps to 0');

// ─────────────────────────────────────────────────────────── rupees
resetState();
eq(E.rupees(0), '₹0', 'rupees: 0');
eq(E.rupees(NaN), '₹0', 'rupees: NaN -> ₹0');
eq(E.rupees(500), '₹500', 'rupees: 500 (rounds)');
eq(E.rupees(1500), '₹1.5k', 'rupees: 1500 -> 1.5k');
eq(E.rupees(150000), '₹1.5L', 'rupees: 150000 -> 1.5L');
eq(E.rupees(15000000), '₹1.5Cr', 'rupees: 1.5 crore');
eq(E.rupees(999), '₹999', 'rupees: 999 stays plain');
resetState({ currency: '$' });
eq(E.rupees(500), '$500', 'rupees: respects currency symbol');
resetState();

// ─────────────────────────────────────────────────────────── weeklyRateFor / weeklyInterestFor
resetState({ rate: 10, frequency: 'daily' });
approx(E.weeklyRateFor(), 10/100 * 7 / 365, 1e-9, 'weeklyRateFor: daily 10%');
resetState({ rate: 52, frequency: 'weekly' });
approx(E.weeklyRateFor(), 0.52 / 52, 1e-9, 'weeklyRateFor: weekly normalises to rate/52');
resetState({ rate: 10, frequency: 'daily' });
eq(E.weeklyInterestFor(0), 0, 'weeklyInterestFor: zero balance');
eq(E.weeklyInterestFor(-100), 0, 'weeklyInterestFor: negative balance -> 0');
approx(E.weeklyInterestFor(36500), 36500 * (0.1 * 7 / 365), 0.01, 'weeklyInterestFor: positive');

// ─────────────────────────────────────────────────────────── hasCrossed
resetState({ rate: 10, frequency: 'daily' });
// weekly allowance for base100/age0 = 100. Need weekly interest >= 100.
// weeklyRate ~ 0.0019178; balance needed ~ 52142.
ok(E.hasCrossed(60000, 100, 0) === true, 'hasCrossed: high balance crosses');
ok(E.hasCrossed(1000, 100, 0) === false, 'hasCrossed: low balance does not cross');

// ─────────────────────────────────────────────────────────── earnedBadgeIds
eq(E.earnedBadgeIds({ interest: 0, contributed: 100 }), [], 'badges: no interest -> none');
eq(E.earnedBadgeIds({ interest: 1, contributed: 100 }), ['firstSpark'], 'badges: ₹1 -> firstSpark');
eq(E.earnedBadgeIds({ interest: 100, contributed: 1000 }), ['firstSpark','self100'], 'badges: ₹100');
eq(E.earnedBadgeIds({ interest: 1000, contributed: 5000 }), ['firstSpark','self100','self1k'], 'badges: ₹1k');
eq(E.earnedBadgeIds({ interest: 100000, contributed: 999999 }),
   ['firstSpark','self100','self1k','self10k','self100k'], 'badges: ₹1L all self-made');
eq(E.earnedBadgeIds({ interest: 500, contributed: 400 }),
   ['firstSpark','self100','doubling'], 'badges: interest>contributed -> doubling');
ok(!E.earnedBadgeIds({ interest: 50, contributed: 0 }).includes('doubling'),
   'badges: doubling needs contributed>0');

// ─────────────────────────────────────────────────────────── interestOver
resetState({ rate: 10, frequency: 'daily' });
eq(E.interestOver(0, 100), 0, 'interestOver: zero balance');
eq(E.interestOver(1000, 0), 0, 'interestOver: zero days');
eq(E.interestOver(-5, 10), 0, 'interestOver: negative balance');
approx(E.interestOver(36500, 365), 36500 * 0.1, 1, 'interestOver: daily ~ full year of 10%');
resetState({ rate: 12, frequency: 'monthly' });
approx(E.interestOver(1200, 31), 1200 * (0.12/12) * 1, 0.5, 'interestOver: monthly one full month (31d)');
eq(E.interestOver(1200, 29), 0, 'interestOver: monthly <1 month floors to 0');
resetState({ rate: 10, frequency: 'yearly' });
approx(E.interestOver(1000, 400), 1000 * 0.1 * 1, 0.5, 'interestOver: yearly one year');
resetState();

// ─────────────────────────────────────────────────────────── dueWeeks
resetState();
{
  // Child born exactly 3 weeks ago, never paid -> ~4 weekly ticks (birth + 3)
  const bd = new Date(Date.now() - 21 * DAY).toISOString().split('T')[0];
  const weeks = E.dueWeeks(bd, 100, null);
  ok(weeks.length >= 3 && weeks.length <= 5, 'dueWeeks: 3wk-old child -> ~4 ticks, got ' + weeks.length);
  ok(weeks.every(w => w.amount === 100), 'dueWeeks: each tick uses base*(age+1)=100 for infant');
}
{
  // lastPaid = now -> nothing due
  const bd = new Date(Date.now() - 21 * DAY).toISOString().split('T')[0];
  const weeks = E.dueWeeks(bd, 100, Date.now());
  eq(weeks.length, 0, 'dueWeeks: lastPaid=now -> nothing due');
}
{
  // future birthdate -> empty
  const bd = new Date(Date.now() + 7 * DAY).toISOString().split('T')[0];
  eq(E.dueWeeks(bd, 100, null), [], 'dueWeeks: unborn -> empty');
}

// ─────────────────────────────────────────────────────────── buildLedger
resetState({ rate: 10, frequency: 'daily' });
{
  const bd = yearsAgoISO(2);
  const empty = E.buildLedger(bd, []);
  eq(empty.balance, 0, 'buildLedger: no entries -> 0 balance');
  eq(empty.contributed, 0, 'buildLedger: no entries -> 0 contributed');
}
{
  // Single deposit of 1000 exactly 365 days ago -> ~10% interest
  const bd = yearsAgoISO(5);
  const led = E.buildLedger(bd, [{ time: daysAgo(365), amount: 1000, note: 'x' }]);
  approx(led.balance, 1100, 5, 'buildLedger: 1000 for 1yr @10% -> ~1100');
  eq(led.contributed, 1000, 'buildLedger: contributed = 1000');
  approx(led.interest, 100, 5, 'buildLedger: interest ~ 100');
}
{
  // Spending reduces balance & is tracked in spent
  const bd = yearsAgoISO(5);
  const led = E.buildLedger(bd, [
    { time: daysAgo(365), amount: 1000, note: 'in' },
    { time: daysAgo(180), amount: -400, note: 'out' },
  ]);
  eq(led.spent, 400, 'buildLedger: spent tracked as positive 400');
  eq(led.contributed, 1000, 'buildLedger: spend does not reduce contributed');
  ok(led.balance > 600 && led.balance < 800, 'buildLedger: balance reflects spend+interest');
}

// ─────────────────────────────────────────────────────────── getChildBase
resetState({ base: 100 });
eq(E.getChildBase({ base: 250 }), 250, 'getChildBase: per-child override wins');
eq(E.getChildBase({ base: null }), 100, 'getChildBase: null falls to settings');
eq(E.getChildBase({}), 100, 'getChildBase: missing falls to settings');
eq(E.getChildBase({ base: 0 }), 100, 'getChildBase: 0 treated as unset -> settings');

// ─────────────────────────────────────────────────────────── owedInterest / topUpBreakdown
resetState({ rate: 10, frequency: 'daily', base: 100 });
{
  // No entries -> nothing owed
  const child = { birthdate: yearsAgoISO(5), entries: [], lastTopUp: null };
  eq(E.owedInterest(child), 0, 'owedInterest: no entries -> 0');
}
{
  // Owed interest is computed on the CURRENT (grown) balance, not the original
  // deposit. 10k grows to ~11k over a year, so owed ≈ 11k * 10% ≈ 1100.
  const child = { birthdate: yearsAgoISO(6), entries: [{ time: daysAgo(365), amount: 10000, note: 'seed' }], lastTopUp: daysAgo(365) };
  approx(E.owedInterest(child), 1100, 60, 'owedInterest: 10k grown ~1yr, owed on current balance -> ~1100');
}
{
  const child = { birthdate: new Date(Date.now() - 21*DAY).toISOString().split('T')[0],
                  entries: [{ time: daysAgo(20), amount: 100, note: 'seed' }],
                  lastPaid: daysAgo(20), lastTopUp: daysAgo(20) };
  const bd = E.topUpBreakdown(child);
  ok(bd.total === bd.allowance + bd.interest, 'topUpBreakdown: total = allowance + interest');
  ok(bd.allowance >= 0 && bd.interest >= 0, 'topUpBreakdown: non-negative parts');
}

// ─────────────────────────────────────────────────────────── getTodaysEarned
resetState({ rate: 10, frequency: 'daily' });
{
  const bd = yearsAgoISO(5);
  const led = E.buildLedger(bd, [{ time: daysAgo(365), amount: 36500, note: 'x' }]);
  const today = E.getTodaysEarned(bd, [{ time: daysAgo(365), amount: 36500, note: 'x' }]);
  // one day's interest at 10%/365 on ~balance
  approx(today, led.balance * (0.1/365), 1, "getTodaysEarned: ~ one day's interest");
  eq(E.getTodaysEarned(bd, []), 0, 'getTodaysEarned: no entries -> 0');
}

// ─────────────────────────────────────────────────────────── DIFFICULTY / TEMPLATES integrity
eq(E.DIFFICULTY_MULTIPLIERS.small, 0.125, 'difficulty: small 12.5%');
eq(E.DIFFICULTY_MULTIPLIERS.medium, 0.25, 'difficulty: medium 25%');
eq(E.DIFFICULTY_MULTIPLIERS.large, 0.50, 'difficulty: large 50%');
ok(E.CHALLENGE_TEMPLATES['5-8'].length > 0, 'templates: 5-8 non-empty');
ok(E.CHALLENGE_TEMPLATES['9-12'].length > 0, 'templates: 9-12 non-empty');
ok(E.CHALLENGE_TEMPLATES['13+'].length > 0, 'templates: 13+ non-empty');
ok(E.CHALLENGE_TEMPLATES['5-8'].every(t => t.name && t.difficulty), 'templates: well-formed');

// ─────────────────────────────────────── mutation-hardening: exact boundaries
// Badge thresholds are >= (inclusive), not > — test the exact boundary.
resetState();
ok(E.earnedBadgeIds({ interest: 10000, contributed: 99999 }).includes('self10k'),
   'badges: interest EXACTLY 10000 earns self10k (>= boundary)');
ok(E.earnedBadgeIds({ interest: 100, contributed: 100 }).includes('doubling'),
   'badges: interest EXACTLY equals contributed earns doubling (>= boundary)');
ok(!E.earnedBadgeIds({ interest: 99, contributed: 100 }).includes('doubling'),
   'badges: interest just below contributed -> no doubling');

// hasCrossed is >= : at the exact threshold it should be true.
resetState({ rate: 10, frequency: 'daily' });
{
  // Find balance where weeklyInterest == weeklyAllowance exactly for base100/age0
  const wr = E.weeklyRateFor();
  const allowance = E.weeklyAllowanceFor(100, 0); // 100
  const exact = allowance / wr; // balance where interest == allowance
  ok(E.hasCrossed(exact + 1, 100, 0) === true, 'hasCrossed: just above threshold true');
  ok(E.hasCrossed(exact - 1, 100, 0) === false, 'hasCrossed: just below threshold false');
}

// weeklyInterestFor: exactly 0 balance -> 0 (guards the > 0 branch)
eq(E.weeklyInterestFor(0), 0, 'weeklyInterestFor: exactly 0 -> 0');

// interestOver: weekly frequency branch (was untested)
resetState({ rate: 52, frequency: 'weekly' });
approx(E.interestOver(10000, 7), 10000 * (0.52/52) * 1, 0.5, 'interestOver: weekly one week');
approx(E.interestOver(10000, 14), 10000 * (0.52/52) * 2, 0.5, 'interestOver: weekly two weeks');
eq(E.interestOver(10000, 6), 0, 'interestOver: weekly <1 week floors to 0');

// interestOver: yearly frequency branch (was untested)
resetState({ rate: 10, frequency: 'yearly' });
approx(E.interestOver(1000, 366), 1000 * 0.1 * 1, 0.5, 'interestOver: yearly one year');
approx(E.interestOver(1000, 732), 1000 * 0.1 * 2, 0.5, 'interestOver: yearly two years');
eq(E.interestOver(1000, 300), 0, 'interestOver: yearly <1 year floors to 0');

// interestOver: exact-zero guards
resetState({ rate: 10, frequency: 'daily' });
eq(E.interestOver(0, 100), 0, 'interestOver: exactly 0 balance -> 0');
eq(E.interestOver(1000, 0), 0, 'interestOver: exactly 0 days -> 0');

// dueWeeks: lastPaid boundary — a tick exactly at lastPaid is NOT re-paid
resetState();
{
  const bd = new Date(Date.now() - 21 * DAY).toISOString().split('T')[0];
  const all = E.dueWeeks(bd, 100, null);
  const firstTickTime = all[0].time;
  // Setting lastPaid to the first tick should drop exactly that tick
  const after = E.dueWeeks(bd, 100, firstTickTime);
  ok(after.length === all.length - 1, 'dueWeeks: lastPaid at a tick excludes that tick (strict >)');
}

// owedInterest anchor: uses lastTopUp when present; falls back to earliest entry
resetState({ rate: 10, frequency: 'daily' });
{
  const recent = { birthdate: yearsAgoISO(6), entries: [{ time: daysAgo(365), amount: 10000, note: 's' }], lastTopUp: daysAgo(10) };
  const stale = { birthdate: yearsAgoISO(6), entries: [{ time: daysAgo(365), amount: 10000, note: 's' }], lastTopUp: daysAgo(365) };
  ok(E.owedInterest(recent) < E.owedInterest(stale),
     'owedInterest: recent lastTopUp owes less than a stale one (anchor matters)');
}

// ─────────────────────────────────────── new gap-fix functions
// canSpend: balance guard shared by classic + playful entry
resetState();
ok(E.canSpend(100, 50) === true, 'canSpend: 50 of 100 ok');
ok(E.canSpend(100, 100) === true, 'canSpend: exactly the full balance ok');
ok(E.canSpend(100, 100.01) === false, 'canSpend: a hair over balance blocked');
ok(E.canSpend(0, 10) === false, 'canSpend: nothing to spend');
ok(E.canSpend(100, 0) === false, 'canSpend: zero amount is not a valid spend');
ok(E.canSpend(100, -5) === false, 'canSpend: negative amount blocked');

// rupeesExact: no k/L/Cr abbreviation, Indian grouping
resetState();
eq(E.rupeesExact(0), '₹0', 'rupeesExact: 0');
eq(E.rupeesExact(NaN), '₹0', 'rupeesExact: NaN -> 0');
eq(E.rupeesExact(1500), '₹1,500', 'rupeesExact: 1500 stays exact (not 1.5k)');
eq(E.rupeesExact(150000), '₹1,50,000', 'rupeesExact: Indian grouping for 1.5L');
eq(E.rupeesExact(-400), '₹-400', 'rupeesExact: negative preserved');
eq(E.rupeesExact(999.6), '₹1,000', 'rupeesExact: rounds');
resetState({ currency: '$' });
eq(E.rupeesExact(1500), '$1,500', 'rupeesExact: respects currency');
resetState();

// serializeState: only durable fields, round-trips through JSON
{
  const s = { children: [{ id: '1', name: 'A', entries: [] }], settings: { currency: '₹', base: 100, rate: 10, frequency: 'daily' }, tasks: { '1': [] }, pending: [], selectedChildId: 'x', entrySign: 'spent', editingChallengeId: 'zzz' };
  const json = E.serializeState(s);
  const back = JSON.parse(json);
  eq(back.children.length, 1, 'serializeState: keeps children');
  eq(back.v, 1, 'serializeState: stamps version');
  ok(!('selectedChildId' in back), 'serializeState: drops transient selectedChildId');
  ok(!('entrySign' in back), 'serializeState: drops transient entrySign');
  ok(!('editingChallengeId' in back), 'serializeState: drops transient editingChallengeId');
  eq(back.settings.base, 100, 'serializeState: keeps settings');
}

// parseBackup: validates shape, normalizes, or throws
{
  const good = { children: [{ id: '1' }], settings: { base: 200 }, tasks: { '1': [] }, pending: [{ id: 'p' }] };
  const p = E.parseBackup(good);
  eq(p.children.length, 1, 'parseBackup: accepts valid');
  eq(p.settings.base, 200, 'parseBackup: keeps settings');
  eq(p.pending.length, 1, 'parseBackup: keeps pending');
}
{
  // missing children array -> throws
  let threw = false;
  try { E.parseBackup({ settings: {} }); } catch (e) { threw = true; }
  ok(threw, 'parseBackup: rejects object with no children array');
}
{
  let threw = false;
  try { E.parseBackup(null); } catch (e) { threw = true; }
  ok(threw, 'parseBackup: rejects null');
}
{
  // tasks/pending default to empty when absent or wrong type
  const p = E.parseBackup({ children: [], tasks: 'nope', pending: 'nope' });
  eq(p.tasks, {}, 'parseBackup: bad tasks -> {}');
  eq(p.pending, [], 'parseBackup: bad pending -> []');
  eq(p.settings.base, 100, 'parseBackup: absent settings -> sanitized defaults (base 100)');
  eq(p.settings.currency, '₹', 'parseBackup: absent settings -> sanitized defaults (currency)');
}

// ─────────────────────────────────────── frequency-aware ledger (gap fix)
// buildLedger must honor state.settings.frequency, not always compound daily.
{
  const bd = yearsAgoISO(5);
  const entries = [{ time: daysAgo(400), amount: 10000, note: 'seed' }];
  resetState({ rate: 10, frequency: 'daily' });
  const daily = E.buildLedger(bd, entries).balance;
  resetState({ rate: 10, frequency: 'yearly' });
  const yearly = E.buildLedger(bd, entries).balance;
  resetState({ rate: 10, frequency: 'weekly' });
  const weekly = E.buildLedger(bd, entries).balance;
  ok(daily !== yearly, 'buildLedger: daily and yearly balances differ (frequency respected)');
  // daily is simple accrual: 10000 * (0.1/365) * 400 ≈ 1096 interest
  ok(Math.abs(daily - 11096) < 30, 'buildLedger: daily ~ simple 10%/365 over 400d ≈ 11096');
  // yearly: 400 days = 1 completed year -> exactly +10%
  ok(Math.abs(yearly - 11000) < 5, 'buildLedger: yearly 400d = 1 completed year = 11000');
  ok(weekly > 10000 && Math.abs(weekly - daily) < 200, 'buildLedger: weekly accrues by completed weeks, near daily');
  resetState();
}

// accrueInterest and interestOver agree (interestOver is just rounded accrue)
resetState({ rate: 10, frequency: 'daily' });
approx(E.interestOver(10000, 365), Math.round(E.accrueInterest(10000, 365) * 100) / 100, 0.001,
  'interestOver == round(accrueInterest): daily');
resetState({ rate: 10, frequency: 'monthly' });
approx(E.interestOver(10000, 90), Math.round(E.accrueInterest(10000, 90) * 100) / 100, 0.001,
  'interestOver == round(accrueInterest): monthly');
resetState();

// accrueInterest guards
resetState({ rate: 10, frequency: 'daily' });
eq(E.accrueInterest(0, 100), 0, 'accrueInterest: zero balance');
eq(E.accrueInterest(1000, 0), 0, 'accrueInterest: zero days');
eq(E.accrueInterest(-50, 100), 0, 'accrueInterest: negative balance');
resetState();

// ─────────────────────────────────────── convertAmounts (FX conversion)
resetState();
{
  const parts = {
    children: [
      { id: '1', name: 'A', base: 100, entries: [{ time: 1, amount: 1000, note: 'x' }, { time: 2, amount: -400, note: 'y' }] },
      { id: '2', name: 'B', base: null, entries: [{ time: 1, amount: 830, note: 'z' }] },
    ],
    pending: [{ id: 'p', amount: 8300, due: [{ time: 1, amount: 8300 }] }],
    settings: { base: 100, rate: 10, frequency: 'daily', currency: '₹' },
  };
  // ₹ -> $ at 1/83 ≈ 0.01205
  const fx = 1 / 83;
  const out = E.convertAmounts(parts, fx);
  approx(out.children[0].entries[0].amount, 1000 / 83, 0.01, 'convert: entry 1000₹ -> ~12.05$');
  approx(out.children[0].entries[1].amount, -400 / 83, 0.01, 'convert: spend -400 stays negative & scaled');
  approx(out.children[0].base, 100 / 83, 0.01, 'convert: per-child base scaled');
  eq(out.children[1].base, null, 'convert: null base stays null (uses household default)');
  approx(out.children[1].entries[0].amount, 10, 0.01, 'convert: 830₹ -> ~10$');
  approx(out.pending[0].amount, 100, 0.5, 'convert: pending amount scaled');
  approx(out.pending[0].due[0].amount, 100, 0.5, 'convert: pending due[] scaled');
  approx(out.settings.base, 100 / 83, 0.01, 'convert: household base scaled');
  // does not mutate input
  eq(parts.children[0].entries[0].amount, 1000, 'convert: input left unmutated');
}
// identity / invalid rates are no-ops
{
  const parts = { children: [{ id: '1', base: 100, entries: [{ time: 1, amount: 500 }] }], pending: [], settings: { base: 100 } };
  ok(E.convertAmounts(parts, 1) === parts, 'convert: fx=1 is a no-op (same ref)');
  ok(E.convertAmounts(parts, 0) === parts, 'convert: fx=0 rejected, no-op');
  ok(E.convertAmounts(parts, -3) === parts, 'convert: negative fx rejected, no-op');
  ok(E.convertAmounts(parts, NaN) === parts, 'convert: NaN fx rejected, no-op');
}
// round-trip ₹->$->₹ returns close to original
{
  const parts = { children: [{ id: '1', base: null, entries: [{ time: 1, amount: 10000 }] }], pending: [], settings: { base: 100 } };
  const toUsd = E.convertAmounts(parts, 1 / 83);
  const back = E.convertAmounts(toUsd, 83);
  approx(back.children[0].entries[0].amount, 10000, 1, 'convert: ₹->$->₹ round-trips within ₹1');
}

// ─────────────────────────────────────── configurable settings (Pass 4)
// difficultyMultiplier reads from settings.bonusPct, falls back to defaults
resetState();
approx(E.difficultyMultiplier('small'), 0.125, 1e-9, 'difficultyMultiplier: default small');
approx(E.difficultyMultiplier('large'), 0.50, 1e-9, 'difficultyMultiplier: default large');
resetState({ bonusPct: { small: 5, medium: 20, large: 100 } });
approx(E.difficultyMultiplier('small'), 0.05, 1e-9, 'difficultyMultiplier: custom small 5%');
approx(E.difficultyMultiplier('large'), 1.0, 1e-9, 'difficultyMultiplier: custom large 100%');
resetState({ bonusPct: { small: 5 } }); // medium/large missing -> fallback
approx(E.difficultyMultiplier('medium'), 0.25, 1e-9, 'difficultyMultiplier: missing key falls back');
resetState();

// parseBonusPct: validate + fallback per field
{
  const cur = { small: 12.5, medium: 25, large: 50 };
  eq(E.parseBonusPct('10', '30', '60', cur), { small: 10, medium: 30, large: 60 }, 'parseBonusPct: all valid');
  eq(E.parseBonusPct('', 'abc', '-5', cur), cur, 'parseBonusPct: blank/NaN/negative all fall back');
  eq(E.parseBonusPct('0', '25', '50', cur), { small: 0, medium: 25, large: 50 }, 'parseBonusPct: zero is allowed');
}

// parseMilestones: exactly 5 ascending positives, else fallback
{
  const cur = [1, 100, 1000, 10000, 100000];
  eq(E.parseMilestones('2, 200, 2000, 20000, 200000', cur), [2, 200, 2000, 20000, 200000], 'parseMilestones: valid ascending');
  eq(E.parseMilestones('1, 100, 1000', cur), cur, 'parseMilestones: wrong count falls back');
  eq(E.parseMilestones('5, 4, 3, 2, 1', cur), cur, 'parseMilestones: descending falls back');
  eq(E.parseMilestones('1, 100, 100, 1000, 10000', cur), cur, 'parseMilestones: non-strict-ascending falls back');
  eq(E.parseMilestones('a, b, c, d, e', cur), cur, 'parseMilestones: non-numeric falls back');
  eq(E.parseMilestones('', cur), cur, 'parseMilestones: empty falls back');
}

// earnedBadgeIds respects custom milestones
resetState({ badgeMilestones: [10, 500, 5000, 50000, 500000] });
eq(E.earnedBadgeIds({ interest: 5, contributed: 100 }), [], 'badges: below custom first milestone -> none');
eq(E.earnedBadgeIds({ interest: 10, contributed: 100 }), ['firstSpark'], 'badges: at custom first milestone');
eq(E.earnedBadgeIds({ interest: 500, contributed: 9999 }), ['firstSpark', 'self100'], 'badges: custom second milestone');
resetState();

// payCadenceConfig: interval + weekly-multiple
resetState();
eq(E.payCadenceConfig(), { days: 7, weeks: 1 }, 'cadence: default weekly');
resetState({ payCadence: 'fortnightly' });
eq(E.payCadenceConfig(), { days: 14, weeks: 2 }, 'cadence: fortnightly pays 2 weeks');
resetState({ payCadence: 'monthly' });
{
  const c = E.payCadenceConfig();
  eq(c.days, 30, 'cadence: monthly steps 30 days');
  approx(c.weeks, 30 / 7, 1e-9, 'cadence: monthly pays ~4.29 weeks');
}
resetState();

// dueWeeks honors cadence: fortnightly yields ~half the payments of weekly, each ~2x
resetState({ payCadence: 'weekly' });
{
  const bd = new Date(Date.now() - 56 * DAY).toISOString().split('T')[0]; // 8 weeks old
  const weekly = E.dueWeeks(bd, 100, null);
  resetState({ payCadence: 'fortnightly' });
  const fortnightly = E.dueWeeks(bd, 100, null);
  ok(fortnightly.length < weekly.length, 'dueWeeks: fortnightly has fewer payments than weekly');
  ok(fortnightly[0].amount === weekly[0].amount * 2, 'dueWeeks: fortnightly payment is 2x a weekly one');
}
resetState();

// ─────────────────────────────────────── AI prompt generators (Pass 6)
// buildChallengePrompt: age-aware, includes samples, asks for CSV
{
  const p = E.buildChallengePrompt(8, ['Read 20 min', 'Bake cookies', 'Tidy room', 'Extra ignored']);
  ok(/8-year-old/.test(p), 'challengePrompt: includes age');
  ok(/name,difficulty/.test(p), 'challengePrompt: asks for CSV columns');
  ok(/Read 20 min/.test(p) && /Bake cookies/.test(p), 'challengePrompt: seeds samples');
  ok(!/Extra ignored/.test(p), 'challengePrompt: caps samples at 3');
  ok(/small, medium, large/.test(p), 'challengePrompt: lists difficulties');
}
{
  const p = E.buildChallengePrompt(5, []);
  ok(/Read 20 minutes/.test(p), 'challengePrompt: falls back to default samples when none given');
}

// parseChallengeCsv: tolerant parsing
{
  const rows = E.parseChallengeCsv('name,difficulty\nBuild a robot,medium\nLearn words,small\n');
  eq(rows.length, 2, 'csv: skips header, parses 2 rows');
  eq(rows[0], { name: 'Build a robot', difficulty: 'medium' }, 'csv: first row parsed');
  eq(rows[1].difficulty, 'small', 'csv: second difficulty');
}
{
  // messy input: quotes, blank lines, bad difficulty, extra columns
  const rows = E.parseChallengeCsv('"Cook dinner", Large , extra\n\nBadOne,huge\nDraw,SMALL');
  eq(rows.length, 2, 'csv: drops invalid difficulty, keeps valid');
  eq(rows[0], { name: 'Cook dinner', difficulty: 'large' }, 'csv: strips quotes, lowercases, trims');
  eq(rows[1], { name: 'Draw', difficulty: 'small' }, 'csv: uppercase SMALL normalised');
}
eq(E.parseChallengeCsv(''), [], 'csv: empty string -> []');
eq(E.parseChallengeCsv(null), [], 'csv: non-string -> []');
eq(E.parseChallengeCsv('JustAName'), [], 'csv: row without difficulty dropped');

// buildThemePrompt: age-aware, asks for 3 labelled hex
{
  const p = E.buildThemePrompt('space adventure', [5, 8]);
  ok(/space adventure/.test(p), 'themePrompt: includes vibe');
  ok(/aged 5, 8/.test(p), 'themePrompt: includes ages');
  ok(/backdrop: #RRGGBB/.test(p) && /accent: #RRGGBB/.test(p) && /secondary: #RRGGBB/.test(p), 'themePrompt: asks for 3 labelled hex');
}

// parseThemeColors: labelled preferred, else first 3 hex
{
  const c = E.parseThemeColors('backdrop: #0B3D91\naccent: #FFD700\nsecondary: #E03C31');
  eq(c, { backdrop: '#0b3d91', accent: '#ffd700', secondary: '#e03c31' }, 'themeColors: labelled parse (lowercased)');
}
{
  const c = E.parseThemeColors('Here you go: #111111, #222222 and #333333 enjoy!');
  eq(c, { backdrop: '#111111', accent: '#222222', secondary: '#333333' }, 'themeColors: falls back to first 3 hex');
}
ok(E.parseThemeColors('only #aaaaaa and #bbbbbb') === null, 'themeColors: fewer than 3 -> null');
ok(E.parseThemeColors('no colours here') === null, 'themeColors: none -> null');
ok(E.parseThemeColors(null) === null, 'themeColors: non-string -> null');

// bestTextOn: contrast picker
eq(E.bestTextOn('#000000'), '#FFFFFF', 'contrast: white text on black');
eq(E.bestTextOn('#FFFFFF'), '#17140E', 'contrast: dark text on white');
eq(E.bestTextOn('#FFD700'), '#17140E', 'contrast: dark text on bright yellow');
eq(E.bestTextOn('#0B3D91'), '#FFFFFF', 'contrast: white text on deep blue');

// tintToward: lightens toward white, keeps it a valid hex
eq(E.tintToward('#000000', 1), '#ffffff', 'tint: full amount -> white');
eq(E.tintToward('#000000', 0), '#000000', 'tint: zero amount -> unchanged');
{
  const t = E.tintToward('#0b3d91'); // default 0.85 -> mostly white
  ok(/^#[0-9a-f]{6}$/.test(t), 'tint: returns valid hex');
  const r = parseInt(t.slice(1, 3), 16);
  ok(r > 0x0b, 'tint: red channel lightened toward white');
}
eq(E.tintToward('not-a-hex'), '#FBF6EA', 'tint: invalid input -> safe cream default');

// badgeLabel: derives name/blurb from milestones + currency (not hardcoded)
resetState();
{
  const l = E.badgeLabel('self100');
  eq(l.name, '₹100 self-made', 'badgeLabel: default milestone + currency');
  ok(/₹/.test(l.blurb), 'badgeLabel: blurb uses currency');
}
{
  const first = E.badgeLabel('firstSpark');
  ok(/₹/.test(first.blurb), 'badgeLabel: firstSpark blurb uses currency symbol');
  ok(first.name === 'First Spark', 'badgeLabel: firstSpark name');
}
resetState({ badgeMilestones: [50, 500, 5000, 50000, 500000] });
eq(E.badgeLabel('self100').name, '₹500 self-made', 'badgeLabel: tracks changed milestone');
eq(E.badgeLabel('self1k').name, '₹5.0k self-made', 'badgeLabel: second milestone tracks (abbreviated)');
resetState({ currency: '$' });
ok(E.badgeLabel('self100').name.indexOf('$') === 0, 'badgeLabel: tracks currency symbol');
resetState();
// doubling keeps its static label (not a milestone badge)
eq(E.badgeLabel('doubling').name, 'Doubling', 'badgeLabel: non-milestone badge keeps static name');
// unknown id degrades gracefully
{
  const u = E.badgeLabel('nope');
  ok(u && u.emoji, 'badgeLabel: unknown id returns a fallback object');
}

// ─────────────────────────────────────────────────────────── v2 projection
{
  // Zero rate: pure allowance accumulation.
  const r = E.projectForward(0, 0, 100, 0, 10);
  ok(r.final === 1000, 'projectForward: 10wk @0% of 100/wk = 1000');
  ok(r.interest === 0, 'projectForward: no interest at 0% rate');
  ok(r.contributed === 1000, 'projectForward: contributed tracks allowance');
  ok(r.series.length === 11, 'projectForward: series has weeks+1 points');
}
{
  // Positive rate compounds above pure contribution.
  const r = E.projectForward(1000, 1000, 0, 0.01, 52);
  ok(r.final > 1000, 'projectForward: balance grows with interest, no allowance');
  ok(Math.abs(r.contributed - 1000) < 1e-9, 'projectForward: contributed flat when allowance 0');
  ok(r.interest > 0, 'projectForward: interest accrues on balance');
  // 1000 * 1.01^52 ≈ 1677.69
  ok(Math.abs(r.final - 1000 * Math.pow(1.01, 52)) < 1e-6, 'projectForward: matches weekly compounding');
}
{
  const r = E.projectForward(-50, 0, 20, 0, 3);
  ok(r.series[0] === 0, 'projectForward: negative start clamped to 0');
  ok(r.final === 60, 'projectForward: 3wk @20/wk @0% from clamped 0 = 60');
}
{
  ok(E.weeksToGoal(1000, 0, 0.01, 1000) === 0, 'weeksToGoal: already at target = 0');
  ok(E.weeksToGoal(0, 100, 0, 1000) === 10, 'weeksToGoal: 1000 at 100/wk, 0% = 10 weeks');
  ok(E.weeksToGoal(0, 0, 0, 500) === Infinity, 'weeksToGoal: no allowance + no rate never reaches');
  const w = E.weeksToGoal(1000, 0, 0.01, 2000);
  ok(w > 0 && w < 200 && w !== Infinity, 'weeksToGoal: compounding reaches 2x in finite weeks');
}

// ─────────────────────────────────────────────────────────── report

// ============================================================
// SECURITY (folded in from pentest — protects the v2.2.0 hardening)
// ============================================================
{
  const xss = '<img src=x onerror=alert(1)>';
  const a = E.parseBackup({ children: [{ id: 'x', name: xss, entries: [{ time: 1, amount: 5, note: xss }] }],
    tasks: { 'x': [{ id: 't', name: xss, bonus: 5 }] } });
  ok(E.esc(a.children[0].name).indexOf('<') === -1, 'security: esc neutralizes child name');
  ok(E.esc(a.children[0].entries[0].note).indexOf('<') === -1, 'security: esc neutralizes note');
  ok(E.esc(a.tasks.x[0].name).indexOf('<') === -1, 'security: esc neutralizes task name');
  eq(E.esc(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;', 'security: esc covers attribute + element chars');
}
{
  const a = E.parseBackup({ children: [{ id: "x') ;alert(1);//", name: 'ok' }] });
  const id = a.children[0].id;
  ok(!/['";<>\\]/.test(id) && !id.includes(';'), 'security: id safe for onclick interpolation');
}
{
  const a = E.parseBackup({ children: [], settings: JSON.parse('{"__proto__":{"polluted":"yes"},"base":"9e9"}') });
  ok(({}).polluted === undefined, 'security: no prototype pollution via settings');
  ok(a.settings.base <= 1e7, 'security: settings.base clamped');
  ok(!('polluted' in a.settings), 'security: unknown settings keys dropped (whitelist)');
}
{
  const many = { children: Array.from({length: 200}, (_, i) => ({ id: 'c'+i, name: 'n',
    entries: Array.from({length: 8000}, (_, j) => ({ time: j, amount: 1e12 })) })) };
  const a = E.parseBackup(many);
  eq(a.children.length, 30, 'security: children capped at 30 (DoS)');
  eq(a.children[0].entries.length, 5000, 'security: entries capped at 5000 (DoS)');
  eq(a.children[0].entries[0].amount, 1e9, 'security: huge amount clamped to 1e9');
}
{
  const a = E.parseBackup({ children: [{ id: 'x', name: 'n', theme: 'javascript:evil' }], settings: { frequency: 'evil', payCadence: 'evil' } });
  eq(a.children[0].theme, 'aurora', 'security: bad theme falls back to aurora');
  eq(a.settings.frequency, 'daily', 'security: bad frequency falls back to default');
}
{
  const a = E.parseBackup({ children: [{ id: 'x', name: 'n', upi: 'a@bank"><b> x' }] });
  ok(!/[<>"'\s]/.test(a.children[0].upi), 'security: upi stripped of markup + whitespace');
}

// ============================================================
// H1 — duplicate top-up guard (idempotency)
// ============================================================
{
  const pend = [{ id: '1', kind: 'allowance', childId: 'c1' }, { id: '2', kind: 'entry', childId: 'c1' }];
  ok(E.hasPendingAllowance(pend, 'c1'), 'H1: detects an existing allowance pending for the child');
  ok(!E.hasPendingAllowance(pend, 'c2'), 'H1: no false positive for a different child');
  ok(!E.hasPendingAllowance([{ id: '3', kind: 'entry', childId: 'c1' }], 'c1'), 'H1: an entry pending is not an allowance');
  ok(!E.hasPendingAllowance([], 'c1'), 'H1: empty pending is safe');
  ok(!E.hasPendingAllowance(undefined, 'c1'), 'H1: non-array pending is safe');
}

console.log(`\n${passed} passed, ${failed} failed  (${passed + failed} assertions)`);
if (failed) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('ALL TESTS PASSED ✓');
