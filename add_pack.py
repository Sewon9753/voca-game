#!/usr/bin/env python3
"""단어팩 인입 파이프라인: 검증 → 보강(enrich) → 빌드 → 커밋·푸시 → 라이브 확인.
사용: python3 add_pack.py packs/day04.json [--image <원본 사진 경로>...] [--from validate|enrich|build|deploy] [--no-deploy]
전제: packs/dayNN.json 에 pack_id·title·source·words[{n,en,ko}] 가 이미 전사돼 있다(전사는 세션에서 이미지를 보고 직접 한다).
"""
import argparse, json, re, shutil, subprocess, sys, time, unicodedata, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
LIVE = "https://sewon9753.github.io/voca-game/"
VAULT_ATT = Path.home() / "sewon-obsidian" / "05. Archive" / "attachments" / "아들-영어단어-암기게임"
STEPS = ["validate", "enrich", "build", "deploy"]


def sh(cmd, **kw):
    r = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, **kw)
    if r.returncode != 0:
        sys.exit(f"FAIL: {' '.join(cmd)}\n{r.stdout}{r.stderr}")
    return r.stdout


def validate(p: Path):
    pack = json.loads(p.read_text(encoding="utf-8"))
    errs = []
    for k in ("pack_id", "title", "source", "words"):
        if not pack.get(k):
            errs.append(f"missing {k}")
    words = pack.get("words") or []
    if any(w.get("n") != i + 1 for i, w in enumerate(words)):
        errs.append("n 번호가 1..N 연속이 아님")
    for w in words:
        if not re.fullmatch(r"[A-Za-z][A-Za-z' .\-]*", w.get("en", "")):
            errs.append(f"en 형식 이상: {w.get('en')!r}")
        if not re.search(r"[가-힣]", w.get("ko", "")):
            errs.append(f"ko 에 한글 없음: {w.get('en')} → {w.get('ko')!r}")
    ids = [json.loads(q.read_text(encoding="utf-8")).get("pack_id") for q in (ROOT / "packs").glob("*.json") if q != p]
    if pack.get("pack_id") in ids:
        errs.append(f"pack_id 중복: {pack.get('pack_id')}")
    if errs:
        sys.exit("검증 실패:\n  - " + "\n  - ".join(errs))
    print(f"validate OK: {pack['title']} · {len(words)}단어")
    return pack


def archive_images(images, day_tag):
    VAULT_ATT.mkdir(parents=True, exist_ok=True)
    # 맥 파일명은 NFD·글롭 패턴은 NFC → 정규화해 비교(DAY03 미검출로 번호 중복 났던 버그)
    existing = [q for q in VAULT_ATT.iterdir() if unicodedata.normalize("NFC", q.name).startswith("아들-영어단어-") and q.suffix.lower() in (".jpeg", ".jpg", ".png")]
    seq = len(existing)
    out = []
    for src in images:
        src = Path(src)
        seq += 1
        dst = VAULT_ATT / f"아들-영어단어-{seq:02d}-능률VOCA-중등필수-{day_tag}{src.suffix.lower()}"
        shutil.copy2(src, dst)
        out.append(dst.name)
        print(f"archived → {dst}")
    return out


def live_build():
    try:
        html = urllib.request.urlopen(f"{LIVE}?t={int(time.time())}", timeout=15).read().decode()
        m = re.search(r"packs\.js\?v=([0-9.]+)", html)
        return m.group(1) if m else None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("--image", nargs="*", default=[], help="원본 스캔 이미지(볼트 attachments 로 보관)")
    ap.add_argument("--from", dest="start", choices=STEPS, default="validate")
    ap.add_argument("--no-deploy", action="store_true")
    ap.add_argument("--model", default="claude-opus-5")
    a = ap.parse_args()
    p = Path(a.pack)
    if not p.is_absolute():
        p = ROOT / p
    start = STEPS.index(a.start)

    pack = validate(p)
    day_tag = re.sub(r"[^A-Za-z0-9]+", "", p.stem.upper()) or p.stem
    if a.image:
        archive_images(a.image, day_tag)

    if start <= STEPS.index("enrich"):
        print(sh(["python3", "enrich.py", str(p), "--model", a.model]), end="")
        validate(p)
        pk = json.loads(p.read_text(encoding="utf-8"))
        missing = [w["en"] for w in pk["words"] if not all(w.get(f) for f in ("ipa", "stress", "emoji", "ex", "ex_ko", "mnemonic"))]
        if missing:
            sys.exit(f"enrich 누락: {missing}")

    if start <= STEPS.index("build"):
        out = sh(["python3", "build_packs.py"])
        print(out, end="")
        t = sh(["node", "--test", "test/engine.test.js"])
        if "fail 0" not in t:
            sys.exit("엔진 테스트 실패:\n" + t[-1500:])
        print("tests: OK")

    if a.no_deploy or start > STEPS.index("deploy"):
        return
    build = re.search(r"VOCA_BUILD = '([^']+)'", (ROOT / "packs.js").read_text(encoding="utf-8")).group(1)
    sh(["git", "add", "-A"])
    st = sh(["git", "status", "--porcelain"])
    if st.strip():
        sh(["git", "-c", "user.name=sewonjo", "-c", "user.email=jsw5668@gmail.com", "commit", "-q", "-m",
            f"pack: {pack['title']} ({len(pack['words'])}단어) · build {build}\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"])
    subprocess.run(["git", "push", "-q", "origin", "main"], cwd=ROOT, check=True)
    print(f"pushed. waiting for live build {build} …")
    for i in range(15):
        lv = live_build()
        if lv == build:
            print(f"LIVE OK: {LIVE} build {lv}")
            return
        time.sleep(20)
    sys.exit(f"라이브 미반영(마지막 확인 {live_build()}) — GitHub Pages 빌드를 확인하세요: gh api repos/Sewon9753/voca-game/pages/builds/latest")


if __name__ == "__main__":
    main()
