#!/usr/bin/env python3
"""단어팩 보강: packs/dayNN.json 의 각 단어에 ipa·stress·emoji·ex·ex_ko·mnemonic 을 claude -p 로 생성해 채운다.
사용: python3 enrich.py packs/day03.json [--force] [--batch 8] [--model claude-opus-5]
끝나면 build_packs.py 로 packs.js 를 재생성한다.
"""
import argparse, json, re, subprocess, sys, time
from pathlib import Path

FIELDS = ["ipa", "stress", "emoji", "ex", "ex_ko", "mnemonic"]

PROMPT = """You are helping a Korean middle-school student (13-14세) memorize English vocabulary.
For EACH word below, produce ONE JSON object. Output ONLY a JSON array, no prose, no code fence.

Fields (all required):
- "en": the word exactly as given
- "ipa": American English IPA, e.g. "/ˈfaɪnəli/"
- "stress": syllables separated by "-", the primary-stressed syllable in ALL CAPS, others lowercase. Phrases keep spaces between words, e.g. "FI-nal-ly", "be FA-mous for", "SUN-light". One-syllable words are ALL CAPS, e.g. "PACK".
- "emoji": 1-3 emoji that visually anchor the meaning (no text)
- "ex": ONE short, realistic everyday sentence (6-10 words) a teenager would actually say or hear, using the word in its most common meaning. Simple grammar.
- "ex_ko": natural Korean translation of "ex"
- "mnemonic": 한국어 연상법 1-2문장 (60자 이내). 우선순위: ① 발음과 비슷한 한국어 소리를 뜻과 엮기 (예: bark → "박! 하고 개가 짖다"), ② 어원·조합(sun+light), ③ 이미지 장면. 학생에게 말하듯 쉽게. 이모지 없이 텍스트만.

Words (en / Korean meaning from the textbook):
__WORDS__
"""


def call_claude(words, model):
    listing = "\n".join(f"- {w['en']} / {w['ko']}" for w in words)
    prompt = PROMPT.replace("__WORDS__", listing)
    cmd = ["claude", "-p", prompt, "--model", model, "--output-format", "text", "--tools", ""]
    for attempt in range(3):
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        out = r.stdout.strip()
        m = re.search(r"\[.*\]", out, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        sys.stderr.write(f"  retry {attempt+1}: rc={r.returncode} out[:200]={out[:200]!r} err[:200]={r.stderr[:200]!r}\n")
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("claude -p returned no JSON array")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("--force", action="store_true", help="이미 채워진 단어도 다시 생성")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--model", default="claude-opus-5")
    a = ap.parse_args()

    p = Path(a.pack)
    pack = json.loads(p.read_text(encoding="utf-8"))
    todo = [w for w in pack["words"] if a.force or not all(w.get(f) for f in FIELDS)]
    print(f"{p.name}: {len(pack['words'])} words, {len(todo)} to enrich (model={a.model})")
    by_en = {w["en"]: w for w in pack["words"]}
    for i in range(0, len(todo), a.batch):
        chunk = todo[i:i + a.batch]
        print(f"  batch {i // a.batch + 1}: {[w['en'] for w in chunk]}")
        for item in call_claude(chunk, a.model):
            w = by_en.get(item.get("en"))
            if not w:
                sys.stderr.write(f"  unknown word in output: {item.get('en')!r}\n")
                continue
            for f in FIELDS:
                if item.get(f):
                    w[f] = str(item[f]).strip()
        p.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    missing = [w["en"] for w in pack["words"] if not all(w.get(f) for f in FIELDS)]
    print(f"done. missing fields: {missing or 'none'}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
