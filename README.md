# 단어 게임 (개인 · 비업무)

아들 영어단어 암기용 웹앱. 설치 없이 브라우저에서 `index.html`을 열면 됩니다.

- 규칙: 영어 제시 → 5초 카운트(탭하면 즉시) → 뜻 공개 → O/X 자기판정 → 틀린 것만 반복 → 뜻 제시 → 영어 (동일)
- 파일: `index.html`(UI) · `engine.js`(로직) · `packs.js`(내장 단어팩) · `packs/*.json`(원본)
- 테스트: `node --test test/engine.test.js`
- 카드 학습: 발음(브라우저 TTS)·강세·이모지·예문·연상법·🎤 발음 연습(음성인식 일치율 + 소리 크기 곡선 + 내 녹음 재생). 마이크는 https(GitHub Pages)에서만 동작.
- 단어팩 추가: 사진을 보고 `packs/dayNN.json`(en/ko) 전사 → `python3 add_pack.py packs/dayNN.json --image <사진>` 한 줄(검증→enrich→build→테스트→push→라이브 확인). Claude Code 스킬 `/단어팩` 이 이 절차를 지휘한다.

계획 노트: 옵시디언 `02. Projects/개인/아들 영어단어 암기게임/`
