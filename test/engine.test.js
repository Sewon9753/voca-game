const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const W = [
  { n: 1, en: 'pack', ko: '싸다' },
  { n: 2, en: 'male', ko: '남성' },
  { n: 3, en: 'valley', ko: '계곡' },
];
const noShuffle = (arr) => arr.slice();

test('new session starts at phase en2ko pass 1 showing first word', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  const c = E.current(s);
  assert.equal(s.phase, 'en2ko');
  assert.equal(s.pass, 1);
  assert.equal(c.index, 0);
  assert.equal(c.total, 3);
  assert.equal(c.prompt, 'pack');
  assert.equal(c.answer, '싸다');
});

test('ko2en phase swaps prompt and answer', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  s.phase = 'ko2en';
  const c = E.current(s);
  assert.equal(c.prompt, '싸다');
  assert.equal(c.answer, 'pack');
});

test('answering advances to next word', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  E.answer(s, true);
  assert.equal(E.current(s).prompt, 'male');
});

test('all O in pass 1 moves to ko2en with full queue', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  E.answer(s, true); E.answer(s, true);
  const ev = E.answer(s, true);
  assert.equal(s.phase, 'ko2en');
  assert.equal(s.pass, 1);
  assert.equal(E.current(s).total, 3);
  assert.equal(E.current(s).prompt, '싸다');
  assert.equal(ev.type, 'phase');
});

test('wrong words only are replayed in pass 2 until none wrong', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  E.answer(s, true);
  E.answer(s, false);      // male wrong
  const ev = E.answer(s, false); // valley wrong
  assert.equal(ev.type, 'retry');
  assert.equal(ev.count, 2);
  assert.equal(s.phase, 'en2ko');
  assert.equal(s.pass, 2);
  assert.equal(E.current(s).total, 2);
  assert.deepEqual(s.queue.map(i => W[i].en), ['male', 'valley']);
  E.answer(s, true);
  E.answer(s, false);      // valley still wrong
  assert.equal(s.pass, 3);
  assert.deepEqual(s.queue.map(i => W[i].en), ['valley']);
  E.answer(s, true);
  assert.equal(s.phase, 'ko2en');
  assert.equal(s.pass, 1);
});

test('finishing ko2en with all O ends the session', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  for (let i = 0; i < 6; i++) E.answer(s, true);
  assert.equal(s.phase, 'done');
  assert.equal(E.current(s), null);
});

test('retry queue is shuffled with the given shuffle fn', () => {
  const reverse = (arr) => arr.slice().reverse();
  const s = E.createSession(W, { shuffle: noShuffle });
  s.shuffle = reverse;
  E.answer(s, false); E.answer(s, false); E.answer(s, true);
  assert.deepEqual(s.queue.map(i => W[i].en), ['male', 'pack']);
});

test('summary lists rounds and counts X per word', () => {
  const s = E.createSession(W, { shuffle: noShuffle });
  E.answer(s, false); E.answer(s, true); E.answer(s, true); // en2ko p1: pack X
  E.answer(s, true);                                        // en2ko p2: pack O
  E.answer(s, true); E.answer(s, false); E.answer(s, true); // ko2en p1: male X
  E.answer(s, true);                                        // ko2en p2
  const sm = E.summary(s);
  assert.deepEqual(sm.rounds.map(r => [r.phase, r.pass, r.ok, r.ng]), [
    ['en2ko', 1, 2, 1], ['en2ko', 2, 1, 0], ['ko2en', 1, 2, 1], ['ko2en', 2, 1, 0],
  ]);
  assert.deepEqual(sm.weak.map(w => [w.en, w.misses]), [['pack', 1], ['male', 1]]);
});

test('parsePack turns pasted lines into words', () => {
  const words = E.parsePack('pack\t싸다\nmale - 남성\n\nvalley : 계곡\n');
  assert.deepEqual(words, [
    { n: 1, en: 'pack', ko: '싸다' },
    { n: 2, en: 'male', ko: '남성' },
    { n: 3, en: 'valley', ko: '계곡' },
  ]);
});

test('pronunciationScore: exact match is 1, partial phrase match is word ratio', () => {
  assert.equal(E.pronunciationScore('be famous for', 'Be famous for.'), 1);
  assert.equal(E.pronunciationScore('be famous for', 'the famous four'), 1 / 3);
  assert.equal(E.pronunciationScore('valley', ''), 0);
});

test('pronunciationScore: near-miss single word gets partial credit by letter similarity', () => {
  const s = E.pronunciationScore('harmony', 'harmonie');
  assert.ok(s > 0.7 && s < 1, 'got ' + s);
  assert.equal(E.pronunciationScore('pill', 'peel') < 0.6, true);
});

test('stressSyllables parses FI-nal-ly into syllables with stress flags', () => {
  assert.deepEqual(E.stressSyllables('FI-nal-ly'), [
    { text: 'fi', stressed: true }, { text: 'nal', stressed: false }, { text: 'ly', stressed: false },
  ]);
  assert.deepEqual(E.stressSyllables('be FA-mous for'), [
    { text: 'be', stressed: false }, { text: 'fa', stressed: true }, { text: 'mous', stressed: false }, { text: 'for', stressed: false },
  ]);
});

test('formatResult renders a plain-text summary for sharing', () => {
  const sm = {
    rounds: [
      { phase: 'en2ko', pass: 1, ok: 21, ng: 3 }, { phase: 'en2ko', pass: 2, ok: 3, ng: 0 },
      { phase: 'ko2en', pass: 1, ok: 24, ng: 0 },
    ],
    weak: [{ en: 'bark', ko: '[동] (개가) 짖다', misses: 2 }, { en: 'able', ko: '…', misses: 1 }],
    elapsedMs: 252000,
  };
  const txt = E.formatResult(sm, { name: '연우', title: 'DAY 03', total: 24, date: '2026-09-07 10:50' });
  assert.equal(txt, [
    '[연우 단어 게임 결과] 2026-09-07 10:50',
    'DAY 03 (24단어) · 4분 12초',
    '1차 영어→뜻: 1회차 21/24, 2회차 3/3',
    '2차 뜻→영어: 1회차 24/24',
    '틀린 단어: bark(2), able(1)',
  ].join('\n'));
});

test('formatResult without name and with no misses', () => {
  const sm = { rounds: [{ phase: 'en2ko', pass: 1, ok: 2, ng: 0 }, { phase: 'ko2en', pass: 1, ok: 2, ng: 0 }], weak: [], elapsedMs: 30000 };
  const txt = E.formatResult(sm, { name: '', title: 'T', total: 2, date: 'D' });
  assert.equal(txt.split('\n')[0], '[단어 게임 결과] D');
  assert.equal(txt.split('\n').pop(), '틀린 단어: 없음 (전부 한 번에 통과)');
});

test('bumpDone counts per pack and kind, keeps last date, never mutates input', () => {
  const d0 = {};
  const d1 = E.bumpDone(d0, 'day04', 'test', '2026-09-07');
  const d2 = E.bumpDone(d1, 'day04', 'test', '2026-09-08');
  const d3 = E.bumpDone(d2, 'day04', 'study', '2026-09-09');
  assert.deepEqual(d0, {});
  assert.deepEqual(d3.day04, { test: 2, study: 1, last: '2026-09-09' });
  assert.equal(E.bumpDone(d3, 'day05', 'study', '2026-09-09').day05.test, 0);
});

test('doneFromSessions backfills test counts by title', () => {
  const ss = [{ date: '2026-09-06', title: 'DAY 03' }, { date: '2026-09-07', title: 'DAY 03' }, { date: '2026-09-07', title: '없는 팩' }];
  const d = E.doneFromSessions(ss, { 'DAY 03': 'day03' });
  assert.deepEqual(d, { day03: { test: 2, study: 0, last: '2026-09-07' } });
});

test('doneLabel is empty at zero and lists only nonzero kinds', () => {
  assert.equal(E.doneLabel(undefined), '');
  assert.equal(E.doneLabel({ test: 0, study: 0, last: '' }), '');
  assert.equal(E.doneLabel({ test: 3, study: 0, last: '2026-09-07' }), '✅ 테스트 3회 · 최근 9/7');
  assert.equal(E.doneLabel({ test: 1, study: 2, last: '2026-09-07' }), '✅ 테스트 1회 · 🃏 카드 2회 · 최근 9/7');
});

// ---- 쓰기 시험
test('maskWord keeps first letter, blanks about 40% of remaining letters, keeps spaces/hyphens', () => {
  const m = E.maskWord('pack', () => 0.99); // rand → 항상 뒤쪽 글자 선택 순서 고정용
  assert.equal(m.length, 4);
  assert.equal(m[0], 'p');
  assert.ok(m.includes('_'));
  const m2 = E.maskWord('calm down', () => 0.5);
  assert.equal(m2[4], ' ');
  assert.equal(m2[0], 'c');
  assert.equal(m2[5], 'd');
  assert.equal(E.maskWord('a', () => 0.5), 'a');
});

test('gradeEn ignores case and outer spaces, marks per-letter diff on miss', () => {
  assert.deepEqual(E.gradeEn('pack', ' Pack '), { ok: true, diff: null });
  const g = E.gradeEn('beautiful', 'beutiful');
  assert.equal(g.ok, false);
  assert.equal(g.diff.map((d) => d.ch).join(''), 'beautiful');
  assert.deepEqual(g.diff.filter((d) => !d.ok).map((d) => d.ch), ['a']);
});

test('parseMeanings splits POS blocks, numbered senses, strips parentheses and brackets', () => {
  const m = E.parseMeanings('[동] 1. (짐을) 싸다 2. 포장하다 / [명] (한) 갑[통/상자]');
  assert.deepEqual(m, [
    { pos: '동', senses: ['싸다', '포장하다'] },
    { pos: '명', senses: ['갑', '통', '상자'] },
  ]);
  assert.deepEqual(E.parseMeanings('아름다운'), [{ pos: '', senses: ['아름다운'] }]);
  assert.deepEqual(E.parseMeanings('[형] 여성[암컷]의 / [명] 여성, 암컷'), [
    { pos: '형', senses: ['여성의', '암컷의'] },
    { pos: '명', senses: ['여성', '암컷'] },
  ]);
});

test('gradeKo: listed sense in any POS is auto O', () => {
  const ko = '[동] 1. (짐을) 싸다 2. 포장하다 / [명] (한) 갑[통/상자]';
  assert.equal(E.gradeKo(ko, '포장하다 ').verdict, 'ok');
  assert.equal(E.gradeKo(ko, '상자').verdict, 'ok');
  assert.equal(E.gradeKo(ko, '짐을 싸다').verdict, 'ok');
});

test('gradeKo: single-POS word with wrong-POS ending is auto X with reason', () => {
  const g = E.gradeKo('[형] 아름다운', '아름다움');
  assert.equal(g.verdict, 'pos');
  const g2 = E.gradeKo('[명] 계곡', '계곡한');
  assert.equal(g2.verdict, 'pos');
  const g3 = E.gradeKo('[동] 싸다', '포장');
  assert.equal(g3.verdict, 'pos');
});

test('gradeKo: unmatched but plausible answer falls back to self-judge', () => {
  assert.equal(E.gradeKo('[형] 아름다운', '예쁜').verdict, 'ask');
  assert.equal(E.gradeKo('[동] 1. (짐을) 싸다 2. 포장하다 / [명] (한) 갑', '아름다움').verdict, 'ask');
  assert.equal(E.gradeKo('[형] 아름다운', '').verdict, 'ng');
});

test('createSession with write phases runs hint→blank→ko→dictation', () => {
  const s = E.createSession(W, { shuffle: noShuffle, phases: E.WRITE_PHASES });
  assert.deepEqual(E.WRITE_PHASES, ['hint', 'blank', 'ko', 'dict']);
  assert.equal(s.phase, 'hint');
  W.forEach(() => E.answer(s, true));
  assert.equal(s.phase, 'blank');
  W.forEach(() => E.answer(s, true));
  assert.equal(s.phase, 'ko');
  W.forEach(() => E.answer(s, true));
  assert.equal(s.phase, 'dict');
  W.forEach(() => E.answer(s, true));
  assert.equal(s.phase, 'done');
});

test('formatResult labels write phases', () => {
  const sm = { rounds: [{ phase: 'hint', pass: 1, ok: 3, ng: 0 }, { phase: 'blank', pass: 1, ok: 2, ng: 1 }, { phase: 'blank', pass: 2, ok: 1, ng: 0 }, { phase: 'ko', pass: 1, ok: 3, ng: 0 }, { phase: 'dict', pass: 1, ok: 3, ng: 0 }], weak: [{ en: 'pack', ko: '싸다', misses: 1 }], elapsedMs: 90000 };
  const lines = E.formatResult(sm, { name: '연우', title: 'DAY 03', total: 3, date: 'D', kind: 'write' }).split('\n');
  assert.equal(lines[0], '[연우 쓰기 시험 결과] D');
  assert.ok(lines.includes('1차 힌트 쓰기: 1회차 3/3'));
  assert.ok(lines.includes('2차 백지 쓰기: 1회차 2/3, 2회차 1/1'));
  assert.ok(lines.includes('3차 뜻 쓰기: 1회차 3/3'));
  assert.ok(lines.includes('4차 듣고 쓰기: 1회차 3/3'));
});

test('doneLabel shows write count', () => {
  assert.equal(E.doneLabel({ test: 1, study: 0, write: 2, last: '2026-09-11' }), '✅ 테스트 1회 · ✍️ 쓰기 2회 · 최근 9/11');
  assert.equal(E.doneLabel({ test: 0, study: 0, write: 0, last: '' }), '');
});

test('parseMeanings: bracket alternative in the middle of a phrase, ellipsis prefix ignored in grading', () => {
  assert.deepEqual(E.parseMeanings('[동] 어려움[곤경]에 처하다'), [{ pos: '동', senses: ['어려움에 처하다', '곤경에 처하다'] }]);
  assert.equal(E.gradeKo('[동] 어려움[곤경]에 처하다', '곤경에 처하다').verdict, 'ok');
  assert.equal(E.gradeKo('[동] …을 생각해내다', '생각해내다').verdict, 'ok');
});

test('parseMeanings: leading bracket label ([부정문], [소화기관]) is stripped, not treated as alternative', () => {
  assert.deepEqual(E.parseMeanings('[부] 1. [부정문] 아직 2. [의문문] 벌써'), [{ pos: '부', senses: ['아직', '벌써'] }]);
  assert.deepEqual(E.parseMeanings('[명] [소화기관] 위, 배'), [{ pos: '명', senses: ['위', '배'] }]);
});
