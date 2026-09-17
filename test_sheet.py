#!/usr/bin/env python3
"""단어팩 → 인쇄용 시험지 PDF (A4). 학원 시험 전 최종 모의고사용.

사용:
    python3 test_sheet.py day06 --mode en2ko ko2en                # DAY 06 두 방식(각 1장) + 정답지
    python3 test_sheet.py section10-1 section10-2 --mode en2ko    # 두 팩을 합쳐 한 시험(80단어)
    python3 test_sheet.py day06 --mode en2ko --order print        # 프린트 번호 순(기본은 섞기)
    python3 test_sheet.py day06 --mode en2ko --print              # 생성 후 Canon G4010 출력
    python3 test_sheet.py day08 --mode en2ko ko2en --rounds 2 --one-file
        # 두 방식 × 1차·2차 시험지(문항 순서 동일) + 정답지 1장 → PDF 1개(재시험용)
    python3 test_sheet.py day21 day22 day23 --each --rounds 2 --one-file --print
        # --each = 팩마다 별도 세트(합치지 않음). 출력은 뒤 팩·뒤 쪽부터(역순) 보내서
        # 배출 트레이에 앞면 위로 쌓이는 순서가 읽는 순서와 같게 한다(2026-09-17 대표 요청).

방식 순서는 항상 영→뜻 → 뜻→영(난이도 순, 인자 순서 무관).
출력 = 각 PDF를 쪽 역순으로 뒤집은 임시본을 보내고, 여러 세트는 마지막 세트부터 제출한다.

방식: en2ko = 영어 제시 → 한글 뜻 쓰기 / ko2en = 한글 제시 → 영어 쓰기.
쪽당 최대 40문항(2열×20행). 섞기는 --seed 로 재현 가능(기본 = 오늘 날짜).
정답지는 시험지 뒤에 한 쪽(문항 순서 동일)으로 붙는다(--no-key 로 생략).
PDF 변환 = 헤드리스 Chrome. 출력 = ~/Dev/hofn-ai-org/ops/localprint.py 경유(맥북 cupsd 우회).
"""
import argparse, datetime, html, json, random, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PER_PAGE, COLS = 40, 2
MODE_LABEL = {"en2ko": "영어 → 뜻 쓰기", "ko2en": "뜻 → 영어 쓰기"}

CSS = """
@page { size: A4; margin: 12mm 12mm 10mm 12mm; }
* { box-sizing: border-box; }
body { font-family: "Apple SD Gothic Neo", "AppleGothic", "Noto Sans KR", sans-serif; color: #111; margin: 0; }
.page { page-break-after: always; height: 273mm; display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; }
.head { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 2mm; margin-bottom: 4mm; }
.title { font-size: 15pt; font-weight: 700; }
.sub { font-size: 9.5pt; color: #444; margin-top: 1mm; }
.blanks { font-size: 10pt; display: flex; gap: 6mm; }
.blanks span { border-bottom: 1px solid #111; min-width: 28mm; display: inline-block; padding: 0 2mm; }
.grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; flex: 1; align-content: start; }
.row { display: flex; align-items: flex-end; height: var(--rh, 12.4mm); border-bottom: 1px dotted #999; font-size: 11pt; padding-bottom: 1.2mm; }
.row .n { width: 7mm; color: #666; font-size: 9pt; flex: none; }
.row .q { flex: 1; line-height: 1.25; }
.row .q.ko { font-size: 9.5pt; }
.row .a { width: 46mm; flex: none; }
.row .a.wide { width: 40mm; }
.key .grid { align-content: start; }
.key .row { height: auto; min-height: 6mm; align-items: flex-start; font-size: 8.5pt; padding: 0.7mm 0; }
.key .row .q { flex: none; width: 30mm; font-weight: 600; line-height: 1.2; }
.key .row .ans { flex: 1; color: #222; line-height: 1.2; }
"""


def load(pack_ids):
    packs = [json.loads((ROOT / "packs" / f"{p}.json").read_text(encoding="utf-8")) for p in pack_ids]
    words = [w for p in packs for w in p["words"]]
    title = " + ".join(p["title"] for p in packs)
    return title, words


def order_words(words, order, seed):
    ws = list(words)
    if order == "shuffle":
        random.Random(seed).shuffle(ws)
    return ws


def page_html(title, mode, items, start, total, page_no, pages, date, round_label=""):
    rows = []
    for i, w in enumerate(items, start):
        q = html.escape(w["en"] if mode == "en2ko" else w["ko"])
        qcls = "q" if mode == "en2ko" else "q ko"
        rows.append(f'<div class="row"><span class="n">{i}.</span><span class="{qcls}">{q}</span><span class="a"></span></div>')
    # 2열: 왼쪽 열을 먼저 채우고 오른쪽 열 (프린트 읽는 순서와 동일)
    half = (len(rows) + 1) // 2
    rh = min(18.0, 248.0 / max(half, 1))  # 문항이 적으면 행을 키워 쓰기 칸을 넓힌다
    left, right = rows[:half], rows[half:]
    ordered = []
    for k in range(half):
        ordered.append(left[k])
        ordered.append(right[k] if k < len(right) else '<div class="row" style="border:0"></div>')
    return f"""<div class="page">
<div class="head"><div><div class="title">{html.escape(title)} — {MODE_LABEL[mode]}</div>
<div class="sub">{round_label}{total}문항 · {page_no}/{pages}쪽 · {date}</div></div>
<div class="blanks"><span>이름</span><span>점수&nbsp;&nbsp;&nbsp;&nbsp;/ {total}</span></div></div>
<div class="grid" style="--rh:{rh:.1f}mm">{''.join(ordered)}</div></div>"""


def key_html(title, mode, words, date):
    mode_label = f" — {MODE_LABEL[mode]}" if mode else ""
    scope = "문항 순서 시험지와 동일" if mode else "문항 순서 전 방식·전 차수 시험지와 동일"
    rows = []
    for i, w in enumerate(words, 1):
        rows.append(f'<div class="row"><span class="n">{i}.</span><span class="q">{html.escape(w["en"])}</span><span class="ans">{html.escape(w["ko"])}</span></div>')
    pages = []
    for s in range(0, len(rows), 80):  # 정답지는 2열×40행 = 80행/쪽 (영어 | 뜻, 시험지 문항 순)
        chunk = rows[s:s + 80]
        half = (len(chunk) + 1) // 2
        ordered = []
        for k in range(half):
            ordered.append(chunk[k])
            ordered.append(chunk[half + k] if half + k < len(chunk) else "")
        pages.append(f"""<div class="page key">
<div class="head"><div><div class="title">정답지 — {html.escape(title)}{mode_label}</div>
<div class="sub">채점용 · {scope} · {date}</div></div></div>
<div class="grid">{''.join(ordered)}</div></div>""")
    return "".join(pages)


def test_pages(title, mode, words, date, rounds=1):
    """시험지 쪽들. rounds>1 이면 같은 문항 순서로 1차·2차… 반복(재시험용)."""
    total = len(words)
    pages = (total + PER_PAGE - 1) // PER_PAGE
    body = ""
    for r in range(1, rounds + 1):
        label = f"<b>{r}차 시험</b> · " if rounds > 1 else ""
        body += "".join(
            page_html(title, mode, words[s:s + PER_PAGE], s + 1, total, s // PER_PAGE + 1, pages, date, label)
            for s in range(0, total, PER_PAGE)
        )
    return body


def wrap_html(body):
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}</body></html>'


def build_html(title, mode, words, date, with_key, rounds=1):
    body = test_pages(title, mode, words, date, rounds)
    if with_key:
        body += key_html(title, mode, words, date)
    return wrap_html(body)


def build_set_html(title, modes, words, date, with_key, rounds=1):
    """여러 방식을 한 파일에: 방식마다 rounds 회 시험지, 정답지는 마지막 1부(문항 순서 공통)."""
    body = "".join(test_pages(title, m, words, date, rounds) for m in modes)
    if with_key:
        body += key_html(title, None, words, date)
    return wrap_html(body)


def to_pdf(html_path, pdf_path):
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={pdf_path}", f"file://{html_path}"],
                       capture_output=True, text=True, timeout=60)
    if not pdf_path.exists():
        sys.exit(f"PDF 변환 실패: {r.stderr[-500:]}")


def print_pdf(pdf_path, reverse=True):
    """Canon G4010은 앞면 위로 배출 → 쪽 역순으로 보내야 트레이의 묶음이 1쪽부터 읽힌다."""
    sys.path.insert(0, str(Path.home() / "Dev/hofn-ai-org/ops"))
    from localprint import submit
    src = Path(pdf_path)
    if reverse:
        import fitz
        d = fitz.open(src)
        r = fitz.open()
        for i in range(len(d) - 1, -1, -1):
            r.insert_pdf(d, from_page=i, to_page=i)
        src = src.with_name(src.stem + ".rev.pdf")
        r.save(src)
    ok = submit(str(src), printer="Canon_G4010_series")
    if reverse:
        src.unlink(missing_ok=True)
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("packs", nargs="+", help="packs/<id>.json 의 id (여러 개면 합쳐서 한 시험)")
    ap.add_argument("--mode", nargs="+", choices=list(MODE_LABEL), default=["en2ko"])
    ap.add_argument("--order", choices=["shuffle", "print"], default="shuffle")
    ap.add_argument("--seed", default=None, help="섞기 시드(기본 오늘 날짜+팩id)")
    ap.add_argument("--out", default=str(ROOT / "sheets"))
    ap.add_argument("--no-key", action="store_true", help="정답지 생략")
    ap.add_argument("--rounds", type=int, default=1, help="시험지 반복 수(1차·2차…, 문항 순서 동일 — 재시험용)")
    ap.add_argument("--one-file", action="store_true",
                    help="모든 방식을 PDF 1개로 합치고 정답지는 마지막 1부만(방식 간 문항 순서 동일)")
    ap.add_argument("--print", dest="do_print", action="store_true", help="생성 후 프린터로 출력")
    ap.add_argument("--each", action="store_true", help="팩마다 별도 세트(합치지 않음)")
    ap.add_argument("--no-reverse", action="store_true", help="출력 시 쪽·세트 역순 뒤집기 생략")
    a = ap.parse_args()
    a.mode = [m for m in MODE_LABEL if m in a.mode]  # 항상 영→뜻 → 뜻→영 순

    date = datetime.date.today().isoformat()
    out = Path(a.out); out.mkdir(exist_ok=True)
    made = []
    for group in ([[p] for p in a.packs] if a.each else [a.packs]):
        made += build_group(group, a, date, out)
    if a.do_print:
        order = made if a.no_reverse else list(reversed(made))
        for mode, pdf_path, _ in order:
            ok = print_pdf(pdf_path, reverse=not a.no_reverse)
            print(f"{'PRINTED' if ok else 'PRINT FAIL'} {pdf_path.name}{'' if a.no_reverse else ' (역순)'}")


def build_group(pack_ids, a, date, out):
    title, words = load(pack_ids)
    stem = "+".join(pack_ids)
    made = []
    if a.one_file:
        seed = a.seed or f"{date}:{stem}"
        ws = order_words(words, a.order, seed)
        h = build_set_html(title, a.mode, ws, date, not a.no_key, a.rounds)
        html_path = out / f"{stem}_set_{date}.html"
        pdf_path = out / f"{stem}_set_{date}.pdf"
        html_path.write_text(h, encoding="utf-8")
        pdf_path.unlink(missing_ok=True)
        to_pdf(html_path.resolve(), pdf_path.resolve())
        made.append(("set", pdf_path, len(ws)))
        print(f"OK {pdf_path}  ({len(ws)}문항, {'+'.join(a.mode)} × {a.rounds}차, 정답지 {'없음' if a.no_key else '1부'}, seed={seed})")
    for mode in ([] if a.one_file else a.mode):
        seed = a.seed or f"{date}:{stem}:{mode}"
        ws = order_words(words, a.order, seed)
        h = build_html(title, mode, ws, date, not a.no_key, a.rounds)
        html_path = out / f"{stem}_{mode}_{date}.html"
        pdf_path = out / f"{stem}_{mode}_{date}.pdf"
        html_path.write_text(h, encoding="utf-8")
        pdf_path.unlink(missing_ok=True)
        to_pdf(html_path.resolve(), pdf_path.resolve())
        made.append((mode, pdf_path, len(ws)))
        print(f"OK {pdf_path}  ({len(ws)}문항, {MODE_LABEL[mode]} × {a.rounds}차, order={a.order}, seed={seed})")
    return made


if __name__ == "__main__":
    main()
