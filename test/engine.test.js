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
