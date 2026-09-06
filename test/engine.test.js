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
