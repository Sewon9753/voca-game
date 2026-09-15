#!/usr/bin/env python3
"""단어팩 → 인쇄용 시험지 PDF (A4). 학원 시험 전 최종 모의고사용.

사용:
    python3 test_sheet.py day06 --mode en2ko ko2en                # DAY 06 두 방식(각 1장) + 정답지
    python3 test_sheet.py section10-1 section10-2 --mode en2ko    # 두 팩을 합쳐 한 시험(80단어)
    python3 test_sheet.py day06 --mode en2ko --order print        # 프린트 번호 순(기본은 섞기)
    python3 test_sheet.py day06 --mode en2ko --print              # 생성 후 Canon G4010 출력

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


def page_html(title, mode, items, start, total, page_no, pages, date):
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
<div class="sub">{total}문항 · {page_no}/{pages}쪽 · {date}</div></div>
<div class="blanks"><span>이름</span><span>점수&nbsp;&nbsp;&nbsp;&nbsp;/ {total}</span></div></div>
<div class="grid" style="--rh:{rh:.1f}mm">{''.join(ordered)}</div></div>"""


def key_html(title, mode, words, date):
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
<div class="head"><div><div class="title">정답지 — {html.escape(title)} — {MODE_LABEL[mode]}</div>
<div class="sub">채점용 · 문항 순서 시험지와 동일 · {date}</div></div></div>
<div class="grid">{''.join(ordered)}</div></div>""")
    return "".join(pages)


def build_html(title, mode, words, date, with_key):
    total = len(words)
    pages = (total + PER_PAGE - 1) // PER_PAGE
    body = "".join(
        page_html(title, mode, words[s:s + PER_PAGE], s + 1, total, s // PER_PAGE + 1, pages, date)
        for s in range(0, total, PER_PAGE)
    )
    if with_key:
        body += key_html(title, mode, words, date)
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}</body></html>'


def to_pdf(html_path, pdf_path):
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={pdf_path}", f"file://{html_path}"],
                       capture_output=True, text=True, timeout=60)
    if not pdf_path.exists():
        sys.exit(f"PDF 변환 실패: {r.stderr[-500:]}")


def print_pdf(pdf_path):
    sys.path.insert(0, str(Path.home() / "Dev/hofn-ai-org/ops"))
    from localprint import submit
    return submit(str(pdf_path), printer="Canon_G4010_series")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("packs", nargs="+", help="packs/<id>.json 의 id (여러 개면 합쳐서 한 시험)")
    ap.add_argument("--mode", nargs="+", choices=list(MODE_LABEL), default=["en2ko"])
    ap.add_argument("--order", choices=["shuffle", "print"], default="shuffle")
    ap.add_argument("--seed", default=None, help="섞기 시드(기본 오늘 날짜+팩id)")
    ap.add_argument("--out", default=str(ROOT / "sheets"))
    ap.add_argument("--no-key", action="store_true", help="정답지 생략")
    ap.add_argument("--print", dest="do_print", action="store_true", help="생성 후 프린터로 출력")
    a = ap.parse_args()

    title, words = load(a.packs)
    date = datetime.date.today().isoformat()
    out = Path(a.out); out.mkdir(exist_ok=True)
    stem = "+".join(a.packs)
    made = []
    for mode in a.mode:
        seed = a.seed or f"{date}:{stem}:{mode}"
        ws = order_words(words, a.order, seed)
        h = build_html(title, mode, ws, date, not a.no_key)
        html_path = out / f"{stem}_{mode}_{date}.html"
        pdf_path = out / f"{stem}_{mode}_{date}.pdf"
        html_path.write_text(h, encoding="utf-8")
        pdf_path.unlink(missing_ok=True)
        to_pdf(html_path.resolve(), pdf_path.resolve())
        made.append((mode, pdf_path, len(ws)))
        print(f"OK {pdf_path}  ({len(ws)}문항, {MODE_LABEL[mode]}, order={a.order}, seed={seed})")
    if a.do_print:
        for mode, pdf_path, _ in made:
            ok = print_pdf(pdf_path)
            print(f"{'PRINTED' if ok else 'PRINT FAIL'} {pdf_path.name}")


if __name__ == "__main__":
    main()
