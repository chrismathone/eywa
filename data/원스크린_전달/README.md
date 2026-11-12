# 선생님 원스크린 — 전달 패키지

> ⚠️ **standalone HTML(파일당 약 23MB)은 2026-11-10부터 git에서 추적하지 않는다**(수정 계획 P4 · 저장소 무게). 받는 법:
> - 이력에서: `git show 32c7bb619df8:"<이 폴더 경로>/<파일 이름>" > "<파일 이름>"` (예: `git show 32c7bb619df8:"data/원스크린_전달/선생님 원스크린 (standalone).html" > "선생님 원스크린 (standalone).html"`)
> - 통째로: `git archive -o handoff.zip 32c7bb619df8 data/원스크린_패키지 data/원스크린_전달`
> - 맥 백업 사본: `~/eywa-data/design-handoff-html-backup-2026-11-10/`

수업 마감을 한 화면에서: ① 진도 확인 ② 일일/확인 테스트 점수 ③ today 보고서 작성·발송

## 들어 있는 파일
- **선생님 원스크린 (standalone).html** — 폰트·스크립트까지 모두 박아 넣은 단독 실행본.
  더블클릭만 하면 인터넷 없이도 **픽셀 동일**하게 열립니다. (그대로 이식/배포용)
- **선생님 원스크린.html** + 아래 소스 — 편집용 원본.
  - `styles.css` — 디자인 토큰/레이아웃 (베이스 톤·밀도·과목 색)
  - `data.js` — 학생 목업 데이터 + 과목별 색 맵(`SUBJECT_COLORS`)
  - `tweaks-panel.jsx` — 우상단 Tweaks 패널
  - `parts.jsx` — 학생 목록·진도·테스트 카드
  - `report.jsx` — today 보고서 카드
  - `app.jsx` — 메인 앱(상태/레이아웃)

## 실행 방법
- **빠르게 보기**: `선생님 원스크린 (standalone).html` 더블클릭.
- **편집본 실행**: 편집용 원본은 같은 폴더의 파일들을 불러오므로 로컬 서버에서 여세요.
  - 예) 폴더에서 터미널: `python3 -m http.server` → 브라우저에서 `http://localhost:8000/선생님 원스크린.html`
  - 편집본은 React·Babel·Pretendard를 CDN에서 받습니다(인터넷 필요). 오프라인은 standalone을 쓰세요.

## 커스터마이즈 포인트
- **과목 색**: `data.js`의 `SUBJECT_COLORS` (수학·파랑 / 영어·자홍 / 과학·연보라 / 국어·주황 / 사회·청록).
- **학생/진도/점수 데이터**: `data.js`의 `STUDENTS`.
- **기본 레이아웃·밀도·베이스 톤**: `app.jsx`의 `TWEAK_DEFAULTS` (현재 stacked / compact / cool).
