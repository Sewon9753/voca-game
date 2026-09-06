// 단어 암기 게임 엔진 — 순수 로직 (브라우저·node 공용)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VocaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PHASES = ['en2ko', 'ko2en'];

  function fisherYates(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function allIdx(words) {
    return words.map((_, i) => i);
  }

  function createSession(words, opts) {
    opts = opts || {};
    const shuffle = opts.shuffle || fisherYates;
    return {
      words,
      shuffle,
      phase: PHASES[0],
      pass: 1,
      queue: shuffle(allIdx(words)),
      pos: 0,
      wrong: [],
      rounds: [{ phase: PHASES[0], pass: 1, ok: 0, ng: 0 }],
      misses: words.map(() => 0),
      startedAt: Date.now(),
      finishedAt: null,
    };
  }

  function current(s) {
    if (s.phase === 'done') return null;
    const w = s.words[s.queue[s.pos]];
    return {
      word: w,
      index: s.pos,
      total: s.queue.length,
      prompt: s.phase === 'en2ko' ? w.en : w.ko,
      answer: s.phase === 'en2ko' ? w.ko : w.en,
    };
  }

  function answer(s, ok) {
    if (s.phase === 'done') return { type: 'done' };
    const idx = s.queue[s.pos];
    const round = s.rounds[s.rounds.length - 1];
    if (ok) round.ok++;
    else {
      round.ng++;
      s.wrong.push(idx);
      s.misses[idx]++;
    }
    s.pos++;
    if (s.pos < s.queue.length) return { type: 'next' };

    if (s.wrong.length > 0) {
      s.pass++;
      s.queue = s.shuffle(s.wrong);
      s.wrong = [];
      s.pos = 0;
      s.rounds.push({ phase: s.phase, pass: s.pass, ok: 0, ng: 0 });
      return { type: 'retry', count: s.queue.length };
    }

    const next = PHASES[PHASES.indexOf(s.phase) + 1];
    if (!next) {
      s.phase = 'done';
      s.finishedAt = Date.now();
      return { type: 'done' };
    }
    s.phase = next;
    s.pass = 1;
    s.queue = s.shuffle(allIdx(s.words));
    s.wrong = [];
    s.pos = 0;
    s.rounds.push({ phase: next, pass: 1, ok: 0, ng: 0 });
    return { type: 'phase', phase: next };
  }

  function summary(s) {
    const weak = s.words
      .map((w, i) => ({ en: w.en, ko: w.ko, misses: s.misses[i] }))
      .filter((w) => w.misses > 0)
      .sort((a, b) => b.misses - a.misses);
    return {
      rounds: s.rounds.map((r) => ({ ...r })),
      weak,
      elapsedMs: (s.finishedAt || Date.now()) - s.startedAt,
    };
  }

  // 붙여넣기 텍스트 → 단어 목록. 구분자: 탭 · " - " · " : " · 2칸 이상 공백
  function parsePack(text) {
    const out = [];
    text.split(/\r?\n/).forEach((line) => {
      const t = line.trim().replace(/^\d+[.)]?\s+/, '');
      if (!t) return;
      const m = t.match(/^(.+?)(?:\t+|\s+-\s+|\s+:\s+|\s{2,})(.+)$/);
      if (!m) return;
      out.push({ n: out.length + 1, en: m[1].trim(), ko: m[2].trim() });
    });
    return out;
  }

  return { createSession, current, answer, summary, parsePack, fisherYates };
});
