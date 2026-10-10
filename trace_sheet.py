#!/usr/bin/env python3
"""단어팩 → 스펠링 따라 쓰기(깜지) 연습지 PDF. 흐린 글씨 위에 덧쓰기, 단어당 N회.
사용:
    python3 trace_sheet.py unit05 unit06 --each                 # 팩마다 PDF 1개(기본 10회·쪽당 14단어)
    python3 trace_sheet.py irregular01 irregular02 --title "불규칙 과거형" --past   # 과거형(ko 앞부분)을 따라 씀
    python3 trace_sheet.py day10 --reps 5 --print --printer Canon_G3060_series
2026-10-04 세션의 인라인 HTML(sheets/day10_trace_2026-10-04.html)을 도구화(2026-10-11).
"""
import argparse, datetime, html, json, sys
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
from test_sheet import to_pdf, print_pdf, load  # noqa: E402

CSS = """
@page { size: A4; margin: 10mm 12mm 8mm 12mm; }
* { box-sizing: border-box; }
body { font-family: "Apple SD Gothic Neo", sans-serif; color: #111; margin: 0; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 1.5mm; margin-bottom: 2mm; }
.title { font-size: 14pt; font-weight: 700; }
.sub { font-size: 9pt; color: #444; }
.blk { padding-top: 0.8mm; }
.lab { font-size: 8.5pt; height: 4.2mm; line-height: 4.2mm; white-space: nowrap; overflow: hidden; }
.lab b { font-size: 9.5pt; margin-right: 1.5mm; }
.lab .en { font-family: "Chalkboard SE", sans-serif; font-weight: 700; font-size: 10.5pt; margin-right: 2.5mm; }
.ln { display: grid; grid-template-columns: repeat(5, 1fr); height: 6.8mm; border-bottom: 0.6px solid #888; }
.ln span { font-family: "Chalkboard SE", sans-serif; font-weight: 300; font-size: 16.5pt; line-height: 6.8mm; color: #c4c4c4; letter-spacing: 0.3pt; white-space: nowrap; }
"""


def trace_target(w, past):
    """past=True 면 ko 의 ' · ' 앞부분(불규칙동사 팩의 과거형)을 따라 쓴다. 발음 주석 등 괄호는 뗀다."""
    if not past:
        return w["en"]
    t = w["ko"].split(" · ")[0]
    return t.split(" [")[0].split(" (")[0].strip()


def span_style(target):
    """5칸 그리드에 긴 단어가 넘치지 않게 길이별로 글자 크기를 줄인다(advertisement 13자 넘침, 2026-10-11)."""
    n = len(target)
    size = 16.5 if n <= 9 else 14 if n <= 11 else 12 if n <= 13 else 10.5
    return "" if size == 16.5 else f' style="font-size:{size}pt"'


def block_html(w, target, reps):
    lines = []
    st = span_style(target)
    for s in range(0, reps, 5):
        n = min(5, reps - s)
        lines.append('<div class="ln">' + "".join(f"<span{st}>{html.escape(target)}</span>" for _ in range(n)) + "</div>")
    return (f'<div class="blk"><div class="lab"><b>{w["n"]}.</b><span class="en">{html.escape(w["en"])}</span>'
            f'{html.escape(w["ko"])}</div>{"".join(lines)}</div>')


def build(title, words, reps, per_page, past, date):
    pages = []
    total = len(words)
    for p in range(0, total, per_page):
        chunk = words[p:p + per_page]
        head = (f'<div class="head"><div><div class="title">{html.escape(title)} — 스펠링 따라 쓰기</div>'
                f'<div class="sub">흐린 글씨 위에 그대로 따라 쓰세요 · 단어마다 {reps}번 · {total}단어 · '
                f'{p // per_page + 1}/{(total + per_page - 1) // per_page}쪽 · {date}</div></div>'
                f'<div class="sub">이름 ____________</div></div>')
        body = "".join(block_html(w, trace_target(w, past), reps) for w in chunk)
        pages.append(f'<div class="page">{head}{body}</div>')
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{"".join(pages)}</body></html>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packs", nargs="+")
    ap.add_argument("--reps", type=int, default=10, help="단어당 따라 쓰기 횟수(5의 배수 권장)")
    ap.add_argument("--per-page", type=int, default=None, help="쪽당 단어 수(기본: 10회=14, 5회=26)")
    ap.add_argument("--past", action="store_true", help="불규칙동사 팩: ko 의 과거형을 따라 쓴다")
    ap.add_argument("--title", default=None)
    ap.add_argument("--each", action="store_true", help="팩마다 별도 PDF")
    ap.add_argument("--out", default=str(ROOT / "sheets"))
    ap.add_argument("--print", dest="do_print", action="store_true")
    ap.add_argument("--printer", default="Canon_G4010_series")
    ap.add_argument("--no-reverse", action="store_true")
    a = ap.parse_args()
    per_page = a.per_page or (14 if a.reps > 5 else 26)
    date = datetime.date.today().isoformat()
    out = Path(a.out); out.mkdir(exist_ok=True)
    groups = [[p] for p in a.packs] if a.each else [a.packs]
    made = []
    for ids in groups:
        title, words = load(ids)
        if a.title and not a.each:
            title = a.title
        stem = "+".join(ids) + "_trace"
        html_path = out / f"{stem}_{date}.html"
        pdf_path = out / f"{stem}_{date}.pdf"
        html_path.write_text(build(title, words, a.reps, per_page, a.past, date), encoding="utf-8")
        to_pdf(html_path, pdf_path)
        pages = (len(words) + per_page - 1) // per_page
        print(f"OK {pdf_path}  ({len(words)}단어 × {a.reps}회, {pages}쪽)")
        made.append(pdf_path)
    if a.do_print:
        for pdf_path in reversed(made):   # 앞면 위 배출 → 마지막 세트부터 보내면 첫 세트가 맨 위
            print(f"print → {pdf_path.name}: {print_pdf(pdf_path, reverse=not a.no_reverse, printer=a.printer)}")


if __name__ == "__main__":
    main()
