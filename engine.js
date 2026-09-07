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

  // ---- 발음 연습 보조
  function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').trim().split(/\s+/).filter(Boolean); }
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function sim(a, b) { const L = Math.max(a.length, b.length); return L ? 1 - lev(a, b) / L : 1; }
  // 목표 단어(구) vs 음성인식 결과 → 0..1. 단어 하나면 철자 유사도, 구면 단어별 적중 비율(유사도 0.8 이상=적중)
  function pronunciationScore(target, heard) {
    const t = norm(target), h = norm(heard);
    if (!t.length) return 0;
    if (!h.length) return 0;
    const best = (w) => Math.max(...h.map((x) => sim(w, x)));
    if (t.length === 1) return best(t[0]);
    return t.filter((w) => best(w) >= 0.8).length / t.length;
  }
  // "be FA-mous for" → [{text, stressed}]  (대문자 음절 = 강세)
  function stressSyllables(pattern) {
    return String(pattern || '').split(/[\s-]+/).filter(Boolean).map((tok) => ({
      text: tok.toLowerCase(),
      stressed: /[A-Z]/.test(tok) && tok === tok.toUpperCase(),
    }));
  }

  // 결과 공유용 텍스트 (카톡 복붙용 · 이모지 없음)
  function formatResult(sm, meta) {
    const s = Math.round(sm.elapsedMs / 1000);
    const time = `${Math.floor(s / 60)}분 ${s % 60}초`;
    const phaseLine = (ph, label) => {
      const rs = sm.rounds.filter((r) => r.phase === ph);
      if (!rs.length) return null;
      return `${label}: ` + rs.map((r) => `${r.pass}회차 ${r.ok}/${r.ok + r.ng}`).join(', ');
    };
    const weak = sm.weak.length ? sm.weak.map((w) => `${w.en}(${w.misses})`).join(', ') : '없음 (전부 한 번에 통과)';
    return [
      `[${meta.name ? meta.name + ' ' : ''}단어 게임 결과] ${meta.date}`,
      `${meta.title} (${meta.total}단어) · ${time}`,
      phaseLine('en2ko', '1차 영어→뜻'),
      phaseLine('ko2en', '2차 뜻→영어'),
      `틀린 단어: ${weak}`,
    ].filter(Boolean).join('\n');
  }

  // 완료 횟수 원장 — { [팩키]: { test: n, study: n, last: 'YYYY-MM-DD' } } (입력 불변)
  function bumpDone(done, key, kind, date) {
    const d = Object.assign({}, done || {});
    const cur = Object.assign({ test: 0, study: 0, last: '' }, d[key]);
    cur[kind] = (cur[kind] || 0) + 1;
    cur.last = date;
    d[key] = cur;
    return d;
  }
  // 예전 세션 기록(제목만 있음)으로 테스트 완료 횟수 1회 백필
  function doneFromSessions(sessions, titleToKey) {
    let d = {};
    (sessions || []).forEach((s) => { const k = titleToKey[s.title]; if (k) d = bumpDone(d, k, 'test', s.date || ''); });
    return d;
  }
  function doneLabel(rec) {
    if (!rec || (!rec.test && !rec.study)) return '';
    const parts = [];
    if (rec.test) parts.push(`✅ 테스트 ${rec.test}회`);
    if (rec.study) parts.push(`🃏 카드 ${rec.study}회`);
    if (rec.last) { const [, m, dd] = rec.last.split('-'); parts.push(`최근 ${+m}/${+dd}`); }
    return parts.join(' · ');
  }

  return { createSession, current, answer, summary, parsePack, fisherYates, pronunciationScore, stressSyllables, formatResult, bumpDone, doneFromSessions, doneLabel };
});
