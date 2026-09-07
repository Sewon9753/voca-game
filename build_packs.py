#!/usr/bin/env python3
"""packs/*.json → packs.js (내장 단어팩) + dist/ 단일 파일 재생성."""
import json, re
from pathlib import Path

root = Path(__file__).parent
build = __import__("datetime").datetime.now().strftime("%m%d.%H%M")
packs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((root / "packs").glob("*.json"))]
(root / "packs.js").write_text(
    "// 내장 단어팩 (file:// 에서도 동작하도록 JS로 내장) — build_packs.py 가 생성\nwindow.VOCA_BUILD = '" + __import__("datetime").datetime.now().strftime("%m%d.%H%M") + "';\nwindow.VOCA_PACKS = "
    + json.dumps(packs, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")

build = __import__("datetime").datetime.now().strftime("%m%d.%H%M")
idx = root / "index.html"
html = re.sub(r'\?v=[^"]*"', f'?v={build}"', idx.read_text(encoding="utf-8"))
idx.write_text(html, encoding="utf-8")
eng = (root / "engine.js").read_text(encoding="utf-8")
pk = (root / "packs.js").read_text(encoding="utf-8")
bundled = re.sub(r'<script src="engine\.js[^"]*"></script>', lambda _: "<script>\n" + eng + "\n</script>", html)
bundled = re.sub(r'<script src="packs\.js[^"]*"></script>', lambda _: "<script>\n" + pk + "\n</script>", bundled)
assert 'src="engine.js' not in bundled and 'src="packs.js' not in bundled
(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "voca-game.html").write_text(bundled, encoding="utf-8")
m = re.search(r"<head>(.*?)</head>\s*<body>(.*?)</body>", bundled, re.S)
head = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", m.group(1))
(root / "dist" / "artifact.html").write_text(head.strip() + "\n" + m.group(2).strip() + "\n", encoding="utf-8")
import hashlib
sw = root / "sw.js"
stamp = hashlib.sha1((html + eng + pk).encode()).hexdigest()[:10]
sw.write_text(re.sub(r"const VERSION = '[^']*';", f"const VERSION = 'v-{stamp}';", sw.read_text(encoding="utf-8")), encoding="utf-8")
print(f"sw.js version v-{stamp}")
print(f"packs: {[ (p['title'], len(p['words'])) for p in packs ]} → packs.js, dist/voca-game.html, dist/artifact.html")
