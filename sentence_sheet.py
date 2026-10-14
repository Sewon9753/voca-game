#!/usr/bin/env python3
"""문장 세트(sentences/*.json) → 인쇄용 서술형·문법 시험지 PDF (A4). 리딩인사이드 워크북 WRITING·GRAMMAR TEST 대비.

사용:
    python3 sentence_sheet.py unit01                     # A 핵심 문장 빈칸 + B 문법 미니퀴즈 + 정답지
    python3 sentence_sheet.py unit01 unit02 --each       # 단원마다 별도 PDF
    python3 sentence_sheet.py unit03 --parts A           # 빈칸 문장만 (B = 문법만)
    python3 sentence_sheet.py unit01 --print --printer Canon_G3060_series

A = 한글 해석 + 영어 문장(핵심 덩어리를 빈칸)으로 덩어리 영작. 워크북 출제 덩어리(wb)는 ★ 표시.
B = 단원 문법 요약 + 미니퀴즈(blank·choose·fix). 정답지는 맨 뒤 1쪽.
PDF 변환·출력은 test_sheet.py 와 동일(헤드리스 Chrome, 역순 출력).
"""
import argparse, datetime, html, json, sys
from pathlib import Path

from test_sheet import to_pdf, print_pdf

ROOT = Path(__file__).parent
CSS = """
@page { size: A4; margin: 12mm 13mm 10mm 13mm; }
* { box-sizing: border-box; }
body { font-family: "Apple SD Gothic Neo", "AppleGothic", "Noto Sans KR", sans-serif; color: #111; margin: 0; font-size: 10.5pt; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.head { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 2mm; margin-bottom: 3mm; }
.title { font-size: 14pt; font-weight: 700; }
.sub { font-size: 9pt; color: #444; margin-top: 1mm; }
.blanks { font-size: 10pt; display: flex; gap: 6mm; }
.blanks span { border-bottom: 1px solid #111; min-width: 26mm; display: inline-block; padding: 0 2mm; }
h2 { font-size: 11.5pt; margin: 3mm 0 2mm; padding: 1mm 2mm; background: #eee; }
.q { display: flex; gap: 2mm; padding: 2.2mm 0; border-bottom: 1px dotted #aaa; break-inside: avoid; }
.q .n { width: 7mm; flex: none; color: #555; }
.q .body { flex: 1; }
.q .ko { color: #333; font-size: 9.5pt; margin-bottom: 1mm; }
.q .en { font-size: 11pt; line-height: 1.7; }
.q .en u { display: inline-block; min-width: 40mm; border-bottom: 1px solid #111; text-decoration: none; }
.q .line { border-bottom: 1px solid #111; height: 7mm; margin-top: 1mm; }
.star { color: #c00; font-size: 9pt; }
.rule { font-size: 9.5pt; color: #333; margin: 0 0 2mm 0; padding-left: 4mm; }
.partb { break-before: page; }
.blk { display: inline-block; min-width: 24mm; border-bottom: 1px solid #111; }
.key .q { padding: 1.2mm 0; font-size: 9.5pt; }
.key .a { font-weight: 700; }
"""


def load(unit):
    f = ROOT / "sentences" / f"{unit}.json"
    if not f.exists():
        sys.exit(f"없음: {f}")
    return json.loads(f.read_text(encoding="utf-8"))


def part_a(d):
    rows = []
    for i, s in enumerate(d["sentences"], 1):
        en, t = s["en"], s["target"]
        k = en.find(t)
        w = max(40, len(t) * 2.3)
        blank = f'<u style="min-width:{w:.0f}mm">&nbsp;</u>'
        if k >= 0 and en != t:
            line = html.escape(en[:k]) + blank + html.escape(en[k + len(t):])
        else:  # 워크북 단독 덩어리 = 해석 보고 통째로 영작
            line = f'<div class="line"></div>'
        star = ' <span class="star">★워크북</span>' if s.get("wb") else ""
        rows.append(f'<div class="q"><span class="n">{i}.</span><div class="body"><div class="ko">{html.escape(s["ko"])}{star}</div><div class="en">{line}</div></div></div>')
    return "<h2>A. 핵심 문장 — 해석을 보고 빈칸에 알맞은 영어를 쓰세요</h2>" + "".join(rows)


def part_b(d):
    g = d.get("grammar") or {}
    rules = "".join(f"<div>· {html.escape(r)}</div>" for r in g.get("summary", []))
    rows = []
    for i, q in enumerate(d.get("quiz", []), 1):
        tip = {"blank": "", "choose": " (알맞은 것 고르기)", "fix": " (틀린 곳을 고쳐 문장 전체 쓰기)"}.get(q.get("type"), "")
        extra = '<div class="line"></div>' if q.get("type") == "fix" else ""
        rows.append(f'<div class="q"><span class="n">{i}.</span><div class="body"><div class="en">{html.escape(q["q"]).replace("____", '<span class="blk">&nbsp;</span>')}<span class="star">{tip}</span></div>{extra}</div></div>')
    return (f"<div class=\"partb\"><h2>B. 문법 — {html.escape(g.get('topic', ''))}</h2><div class=\"rule\">{rules}</div>" + "".join(rows) + "</div>")


def key(d, parts):
    rows = []
    if "A" in parts:
        rows.append("<h2>A 정답</h2>")
        rows += [f'<div class="q"><span class="n">{i}.</span><div class="body"><span class="a">{html.escape(s["target"])}</span> — {html.escape(s.get("point", ""))}</div></div>'
                 for i, s in enumerate(d["sentences"], 1)]
    if "B" in parts:
        rows.append("<h2>B 정답</h2>")
        rows += [f'<div class="q"><span class="n">{i}.</span><div class="body"><span class="a">{html.escape(q["a"])}</span> — {html.escape(q.get("why", ""))}</div></div>'
                 for i, q in enumerate(d.get("quiz", []), 1)]
    return "".join(rows)


def build(units, parts, date):
    ds = [load(u) for u in units]
    title = " + ".join(d["title"].removesuffix(" 문장") for d in ds)
    head = (f'<div class="head"><div><div class="title">{html.escape(title)} — 서술형·문법</div>'
            f'<div class="sub">{date}</div></div><div class="blanks"><span>이름</span><span>점수</span></div></div>')
    body = f'<div class="page">{head}' + "".join(
        (part_a(d) if "A" in parts else "") + (part_b(d) if "B" in parts else "") for d in ds) + "</div>"
    body += (f'<div class="page key"><div class="head"><div><div class="title">정답지 — {html.escape(title)}</div>'
             f'<div class="sub">채점용 · {date}</div></div></div>' + "".join(key(d, parts) for d in ds) + "</div>")
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}</body></html>'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("units", nargs="+", help="sentences/<unit>.json 의 이름 (예: unit01)")
    ap.add_argument("--parts", default="AB", help="A=핵심 문장 빈칸, B=문법 퀴즈 (기본 AB)")
    ap.add_argument("--each", action="store_true", help="단원마다 별도 PDF")
    ap.add_argument("--out", default=str(ROOT / "sheets"))
    ap.add_argument("--print", dest="do_print", action="store_true")
    ap.add_argument("--printer", default="Canon_G4010_series", help="CUPS 프린터명(집=Canon_G3060_series)")
    a = ap.parse_args()
    date = datetime.date.today().isoformat()
    out = Path(a.out); out.mkdir(exist_ok=True)
    made = []
    for group in ([[u] for u in a.units] if a.each else [a.units]):
        stem = "+".join(group)
        hp, pp = out / f"sent_{stem}_{date}.html", out / f"sent_{stem}_{date}.pdf"
        hp.write_text(build(group, a.parts.upper(), date), encoding="utf-8")
        pp.unlink(missing_ok=True)
        to_pdf(hp.resolve(), pp.resolve())
        made.append(pp)
        print(f"OK {pp}")
    if a.do_print:
        for pp in reversed(made):
            print(f"{'PRINTED' if print_pdf(pp, printer=a.printer) else 'PRINT FAIL'} {pp.name} (역순)")


if __name__ == "__main__":
    main()
