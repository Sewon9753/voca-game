// 단어 암기 게임 엔진 — 순수 로직 (브라우저·node 공용)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VocaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PHASES = ['en2ko', 'ko2en'];
  // 쓰기 시험: 힌트 한→영 · 백지 한→영 · 영→한 · 듣고 쓰기
  const WRITE_PHASES = ['hint', 'blank', 'ko', 'dict'];
  const ANSWER_EN = { ko2en: 1, hint: 1, blank: 1, dict: 1 };

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
    const phases = opts.phases || PHASES;
    return {
      words,
      shuffle,
      phases,
      phase: phases[0],
      pass: 1,
      queue: shuffle(allIdx(words)),
      pos: 0,
      wrong: [],
      rounds: [{ phase: phases[0], pass: 1, ok: 0, ng: 0 }],
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
      prompt: ANSWER_EN[s.phase] ? w.ko : w.en,
      answer: ANSWER_EN[s.phase] ? w.en : w.ko,
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

    const phases = s.phases || PHASES;
    const next = phases[phases.indexOf(s.phase) + 1];
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
    const kindLabel = meta.kind === 'write' ? '쓰기 시험' : '단어 게임';
    return [
      `[${meta.name ? meta.name + ' ' : ''}${kindLabel} 결과] ${meta.date}`,
      `${meta.title} (${meta.total}단어) · ${time}`,
      phaseLine('en2ko', '1차 영어→뜻'),
      phaseLine('ko2en', '2차 뜻→영어'),
      phaseLine('hint', '1차 힌트 쓰기'),
      phaseLine('blank', '2차 백지 쓰기'),
      phaseLine('ko', '3차 뜻 쓰기'),
      phaseLine('dict', '4차 듣고 쓰기'),
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
    if (!rec || (!rec.test && !rec.study && !rec.write)) return '';
    const parts = [];
    if (rec.test) parts.push(`✅ 테스트 ${rec.test}회`);
    if (rec.write) parts.push(`✍️ 쓰기 ${rec.write}회`);
    if (rec.study) parts.push(`🃏 카드 ${rec.study}회`);
    if (rec.last) { const [, m, dd] = rec.last.split('-'); parts.push(`최근 ${+m}/${+dd}`); }
    return parts.join(' · ');
  }

  // ---- 쓰기 시험 보조
  // 힌트용 부분 빈칸: 각 낱말의 첫 글자는 남기고 나머지 글자의 약 40%를 '_'로. rand 주입 가능(테스트용)
  function maskWord(word, rand) {
    rand = rand || Math.random;
    const chars = String(word).split('');
    const cand = [];
    chars.forEach((c, i) => {
      if (!/[A-Za-z]/.test(c)) return;
      if (i === 0 || !/[A-Za-z]/.test(chars[i - 1])) return; // 낱말 첫 글자
      cand.push(i);
    });
    if (!cand.length) return chars.join('');
    const n = Math.max(1, Math.round(cand.length * 0.4));
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    cand.slice(0, n).forEach((i) => { chars[i] = '_'; });
    return chars.join('');
  }
  function normEn(t) { return String(t || '').toLowerCase().trim().replace(/\s+/g, ' '); }
  // 영어 채점: 대소문자·바깥 공백 무시 정확 일치. 틀리면 정답 글자별 ok 표시(LCS 정렬 — 빠진 글자만 표시)
  function gradeEn(target, typed) {
    const a = normEn(target), b = normEn(typed);
    if (a === b) return { ok: true, diff: null };
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const okIdx = new Set();
    for (let i = 0, j = 0; i < m && j < n;) {
      if (a[i] === b[j]) { okIdx.add(i); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { ok: false, diff: a.split('').map((ch, i) => ({ ch, ok: okIdx.has(i) })) };
  }
  // 뜻 문자열 → 품사별 뜻 목록. "[동] 1. (짐을) 싸다 2. 포장하다 / [명] (한) 갑[통/상자]"
  // keepParens=true면 괄호 안 내용을 살린 변형("짐을 싸다")도 포함
  function senseList(text, keepParens) {
    let t = String(text || '');
    t = keepParens ? t.replace(/[()]/g, '') : t.replace(/\([^)]*\)/g, '');
    const out = [];
    t.split(/\s*\d+\.\s*|\s*,\s*|\s*;\s*/).map((x) => x.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean).forEach((sense) => {
      const m = sense.match(/^(.*?)(\S+)\[([^\]]+)\](.*)$/); // 앞말[대체1/대체2]뒷말
      if (!m) { out.push(sense.replace(/\s+/g, ' ').trim()); return; }
      const [, pre, head, alts, tail] = m;
      out.push((pre + head + tail).trim());
      alts.split('/').forEach((alt) => out.push((pre + alt.trim() + tail).trim()));
    });
    return out.filter((x, i, arr) => x && arr.indexOf(x) === i);
  }
  function parseMeanings(ko, keepParens) {
    return String(ko || '').split(/\s*\/\s*(?=\[)/).map((block) => {
      const m = block.trim().match(/^\[([^\]]+)\]\s*(.*)$/);
      const pos = m ? m[1].trim() : '';
      return { pos, senses: senseList(m ? m[2] : block, keepParens) };
    }).filter((b) => b.senses.length);
  }
  // 비교용 정규화: 목적어 자리표시(…을/~를/...에)는 붙은 조사째 버리고, 공백·괄호 제거
  function normKo(t) { return String(t || '').replace(/\.{3}/g, '…').replace(/(^|\s)[~…]\S*/g, '').replace(/[\s~…()]/g, '').toLowerCase(); }
  // 품사가 하나뿐일 때 어미로 품사 어긋남을 잡는다 (명백한 경우만 — 나머지는 자기판정)
  const POS_BAD = {
    '형': /(움|음|함|됨|기|성)$/,
    '명': /(다|운|한|는|은|을|히|게|적인)$/,
    '동': /[^다]$/,
  };
  // 한글 채점: verdict = ok(자동 O) · pos(품사 틀림 자동 X) · ng(빈 답) · ask(정답 보여주고 자기판정)
  function gradeKo(ko, typed) {
    const t = normKo(typed);
    const strict = parseMeanings(ko, false), loose = parseMeanings(ko, true);
    const answer = strict.map((b) => (b.pos ? `[${b.pos}] ` : '') + b.senses.join(', ')).join(' / ');
    if (!t) return { verdict: 'ng', answer };
    const all = strict.concat(loose).flatMap((b) => b.senses.map(normKo));
    if (all.includes(t)) return { verdict: 'ok', answer };
    const posList = strict.map((b) => b.pos).filter(Boolean);
    if (posList.length === 1 && POS_BAD[posList[0]] && POS_BAD[posList[0]].test(t)) return { verdict: 'pos', answer, pos: posList[0] };
    return { verdict: 'ask', answer };
  }

  return { createSession, current, answer, summary, parsePack, fisherYates, pronunciationScore, stressSyllables, formatResult, bumpDone, doneFromSessions, doneLabel, WRITE_PHASES, maskWord, gradeEn, parseMeanings, gradeKo };
});
