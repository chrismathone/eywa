# eywa — 디자인 시스템 / UI 컨벤션 (Tier 1)

> CLAUDE.md에서 분리된 **Tier 1 참조 문서**. UI·화면·폼·컴포넌트를 만질 때 관련 절만 읽으세요. 각 규칙 요약은 CLAUDE.md 디자인 규칙 인덱스에.

## 디자인 시스템 (Daylight 시안 적용)

`data/design_handoff_eywa/`의 픽셀 시안 → eywa 코드 매핑 완료. **라이트 전용**, 다크모드 제거.

### 컬러 토큰 (`src/app/globals.css`)
| 토큰 | hex | 용도 |
|---|---|---|
| `--background` | `#fbf9f3` | 페이지 배경 (따뜻한 아이보리) |
| `--bg-soft` | `#f1ede2` | 섹션 구분 / 사이드바 배경 |
| `--card` | `#ffffff` | 카드 표면 |
| `--foreground` / `--ink` | `#1a1f1c` / `#0d1110` | 본문 / 다크 강조 |
| `--text-dim` / `--text-faint` | `#5a635f` / `#9aa39d` | 보조 / 캡션 |
| `--primary` | `#1a5f3c` | **포레스트 그린** — CTA, 활성 메뉴, 출석/완납 |
| `--gold` | `#b8893a` | 강조 · 베타 배지 · AI 라벨 (POWERED BY CLAUDE) |
| `--blue` | `#1f6ba8` | 정보 · 학생 안정 · 영어 과목 |
| `--rose` | `#c44d6d` | 상담 · 학부모 · 국어 과목 |
| `--amber` | `#d68f1a` | 지각 · 부분 납부 · 경고 |
| `--danger` | `#d04848` | 결석 · 미수 · 긴급 |
| `--purple` | `#7a4ba8` | 회계 · 과학 과목 |

차트 슬롯 재매핑: chart-1(blue) · chart-2(primary) · chart-3(amber) · chart-4(danger) · chart-5(rose).

### 라운드 (ijw 운영 톤에 맞춰 시안에서 대폭 축소)
| 토큰 | 시안 | 적용값 |
|---|---|---|
| `--radius-xl` (카드) | 16px | **6px** |
| `--radius-pill` | 999px | **4px** (사각 batch) |
| `--radius-2xl` | 20px | 8px |
| `--radius-3xl` | 24px | 10px |

### 타이포
- **Pretendard Variable** (self-host) + **JetBrains Mono** (메타·숫자·키칩)
- 헬퍼 클래스: `.display-xl 96px / .display-md 56px / .h1-large 32px / .h2 24px / .h3 19px / .body / .body-sm / .caption / .micro (mono 11px 700 uppercase) / .tabular (숫자 강조)`

### Atoms (`src/components/atoms/`)
- ~~**`Initial`** — 이니셜 사각 배지~~ → **제거됨 (2026-06-19, `initial.tsx` 삭제).** 이름 앞에 붙던
  프로필사진/이니셜 배지는 전 화면에서 전부 떼어냈다. **이름 앞 아바타 금지 (⚠️ 영구 규칙)**: 사람
  표시는 **이름 텍스트만** — 이니셜 사각 배지·동그란 프사·이미지 아바타 어느 것도 이름 앞/옆에 새로
  붙이지 말 것 (앞으로도 불필요). 자리 채우기용 빈 아바타 placeholder(`size-N rounded` 회색 칸)도 금지.
- **`Pill`** — mono 11px uppercase, soft/solid + color (primary/gold/blue/rose/amber/danger/purple/neutral)
- **`SectionTitle`** — 14px 700 + action slot

### Botanical 아이콘 (22개)
- `src/components/icons/eywa-icons.tsx` — `<EyIcon name="tree" size={18} />` 단일 컴포넌트
- 이름: tree/leaf/pulse/branch/seed/sprout/wave/falling/roots/pollen/rings/spore/search/bell/arrowUp/arrowDown/arrowRight/play/check/plus/dot/sparkle
- 메뉴 매핑: `MENU_ICON[menuKey]` (대시보드=tree, 시간표=leaf, 출석부=pulse, 학생=seed, 등록상담=sprout, ...)
- AI 강조는 모든 곳에서 `sparkle + gold-soft` 일관

### AppShell
- **Sidebar = 너비 조절형 레일** (bgSoft 배경). 오른쪽 경계선을 잡고 끌면 너비가 따라오고,
  충분히 줄이면 **접힘(52px 아이콘만)**, 늘이면 **펼침(150~360px 아이콘+라벨)**으로 스냅. 더블클릭=빠른
  토글, ←/→ 키도 지원(`role=separator`). 너비/펼침 여부는 `usePrefs`(localStorage `eywa-prefs`)에 영속.
  구현: [`use-sidebar-resize.ts`](src/components/workspace/use-sidebar-resize.ts) 훅 + [`app-sidebar.tsx`](src/components/app-sidebar.tsx).
  접힘 시 hover Tooltip 라벨, 펼침 시 그룹 헤더(01~05) 노출.
- **접힘↔펼침 모핑 애니메이션**(200ms `cubic-bezier(0.22,0.61,0.36,1)`): 아이콘은 left 26px(접힘 레일
  중앙)에 **고정**해 안 튀고, 활성/hover 하이라이트는 절대배치 bg의 `left/right`(8↔4)로 **사각형↔행 모핑**,
  라벨은 `max-width+opacity` 페이드, 그룹 슬롯은 `height`(접힘 6/13 ↔ 펼침 22)로 "패널이 열리듯" 성장.
  **모션 OFF(`usePrefs.animations`)면 트랜지션 전부 0s**(즉시). 드래그 중엔 1:1 추종이라 트랜지션 off.
- 5그룹: 홈 / 수업 / 학생 / 운영 / 지원 + 01~05 인덱스 (mono uppercase)
- 활성 메뉴: primary bg + white text + shadow-primary-glow
- 푸터: 로그인 사용자 **이름 + 호칭**(`display_name` 윗줄 / `job_title` 아랫줄, 빈 호칭은 `ROLE_LABEL` 폴백). 이메일은
  떼고 UserMenu 드롭다운에만 보존(2026-06-30 — "누가 로그인했는지 한눈에"). 미니셸(강사/학생) UserMenu도 동일.
- **Topbar 64px**: breadcrumb (mono 11px primary) + 19px 800 페이지 제목 + 검색바 280px + 알림 + 사용자

### shadcn base-nova (Base UI) 유지 사항
- `render` prop (asChild 아님), `TooltipProvider delay` (delayDuration 아님)
- 일부 atom 함수형 컴포넌트 신규 작성, 나머지 shadcn 그대로 사용

### 스크롤바 — 전역 하네스 (⚠️ 무조건 적용)
**모든 스크롤 영역은 디자인 톤 스크롤바로 통일한다. 옵트인 아님.** `globals.css`의 전역 규칙
(`*`, `*::-webkit-scrollbar*`)이 페이지·패널·드롭다운 팝업·textarea 등 **모든 스크롤 컨테이너에
자동 적용** — 6px, line 컬러(`rgba(13,17,16,0.18)`, hover 0.32) thumb, 투명 track, 999px radius.
- 새 스크롤 영역을 만들 때 **별도 클래스가 필요 없다** (이미 전역). `.scrollbar-thin`은 기존 사용처
  호환용 별칭으로만 남김.
- ⚠️ **네이티브 `<select>`의 옵션 팝업 스크롤바는 OS가 그려 CSS가 닿지 않는다.** 그래서 드롭다운은
  아래 "드롭다운/셀렉트 규약"대로 [`SearchableSelect`](src/components/ui/searchable-select.tsx)로 통일한다
  (styleable 팝오버 `div` → 전역 스크롤바 자동 적용).
- 회색 기본 스크롤바가 한 군데라도 보이면 위반. 새 화면 추가 시 점검.

### 드롭다운/셀렉트 규약 (⚠️ 새 드롭다운 기본값)
- 모든 드롭다운은 [`SearchableSelect`](src/components/ui/searchable-select.tsx)로 통일.
  테두리·padding·ChevronDown·검색 팝오버 일관 + 전역 디자인 스크롤바 적용.
- URL 필터는 [`FilterSelect`](src/components/filter-select.tsx)를 쓴다 — 내부에서 SearchableSelect 렌더
  (`searchable`/`ariaLabel` prop은 호환용, 무시).
- 폼 필드는 `SearchableSelect`에 `name`을 주면 hidden input으로 값 제출.
- **native `<select>` 신규 금지** — OS 팝업은 디자인 스크롤바 미적용·스타일 불일치.
- **자유입력이 필요한 필드(직급 등)는 datalist(`<input list=…>`)도 금지** (2026-06-30). datalist는 ① `list` 속성만
  있으면 **제안이 비어도 브라우저가 ▼를 그려** "고를 게 없는 빈 드롭다운"처럼 보이고, ② 크롬/웨일이 **현재 입력값으로
  제안을 필터링**해 목록 밖 값(예 "부장")이 차 있으면 ▼를 눌러도 아무것도 안 떠 혼란을 준다. `SearchableSelect`는
  목록 전용이라 자유입력을 못 담는다. → **plain `<input>` + 설정값(`operations.*`) "빠른 선택 칩"**(입력칸 아래 항상
  노출, 클릭=채움, 직접 타이핑 그대로). 칩 클릭은 `el.value=…` 후 `input` 이벤트를 dispatch해 초안 자동저장·동시편집
  가드가 변경을 포착하게 한다. 레퍼런스: [staff-form.tsx](<src/app/(shell)/staff/_components/staff-form.tsx>) 직급 필드.

### 비밀번호 입력 규약 (⚠️ 마스킹 비밀번호 필드 기본값, 2026-06-30)
사용자가 **가려지는(`type="password"`) 비밀번호를 칠 때 "잘 쳤는지 확인할 눈 토글"** 이 필요하다(로그인이 대표). 마스킹
비밀번호 입력은 [`PasswordInput`](src/components/ui/password-input.tsx)으로 통일 — 공용 `<Input>` 기반(동일 룩) + 우측 눈
아이콘으로 password↔text 토글. `type`은 내부에서 토글하므로 넘기지 말고, 나머지는 `<Input>`과 동일 props(`name`/`required`/`className` 등).
- 적용: 로그인([login-form](<src/app/(auth)/login/login-form.tsx>))·학원발급 초기비번([super-admin tenants/new](<src/app/(super-admin)/super-admin/tenants/new/_form.tsx>)).
- ⚠️ **이미 `type="text"`로 일부러 보이게 한 필드(직원 임시비번·계정 직접설정 = 원장이 직원에게 불러주는 용도)는 토글 불요** — 대상 아님.
- 새 마스킹 비밀번호 칸은 raw `<input type="password">` 말고 `PasswordInput`을 쓸 것.

### 버튼 크기 — 헤더 액션은 공용 `<Button>` 기본 크기로 통일 (⚠️ 새 버튼 기본값, 2026-06-24)
한 줄(페이지/상세 헤더의 액션 클러스터, 다이얼로그 푸터)에 들어가는 액션 버튼은 **크기가 제각각이면 안 된다**.
증상: 1차 액션은 공용 `<Button>`(기본 `h-8 text-sm`)인데 옆의 2차 액션("통계 보기"·"엑셀 내보내기"·"월별 급여"
등)은 손으로 깎은 `inline-flex … border px-2.5 py-1 text-xs` 작은 링크라 **나란히 두면 높이·글자크기가 따로 논다**
(사용자 제보: 학생상담 헤더 "통계 보기"(작음) ↔ "상담 추가"(큼)).

**규칙(불변): 같은 액션 행의 모든 버튼은 공용 [`Button`](src/components/ui/button.tsx)을 쓰고 크기는 기본값
(`size="default"` = `h-8 text-sm`)으로 통일한다 — "오른쪽(1차) 버튼 크기"가 표준이다.**
- **1차 액션** = `<Button>`(기본 variant=default). **2차 액션** = `<Button variant="outline">`(또는 ghost/secondary).
  variant(색)만 다르고 **size는 전부 같다**.
- **링크/네비/다운로드 버튼**도 손으로 깎지 말고 `render`로 감싼다:
  `<Button variant="outline" render={<WindowLink href=… title=… />}>` / `render={<a href=… />}`(엑셀 export). [[#2]](base-ui는 `asChild` 아닌 `render`)
- **size 변형 금지(헤더/푸터 액션)**: `size="sm"`·`text-xs`·손깎은 `px-2.5 py-1` 버튼을 1차 `<Button>` 옆에 두지 말 것
  (`CreateInvoiceTrigger`의 `size="sm"`·outline 손깎기도 기본 크기로 정규화함). 아이콘은 `className="size-4"`(또는 미지정→Button이 size-4).
- **이 규칙 밖(작은 크기 허용)**: ① **표/리스트 행 안의 인라인 액션**(행 높이에 맞춤) ② **transient 인라인 확인 플로우**
  (삭제 "예/취소" 같은 순간 폼) ③ Pill·배지처럼 버튼이 아닌 칩. 헤더 액션 클러스터에는 적용, 이 셋엔 미적용.
- 전수 적용(2026-06-24): 학생상담·학생목록(엑셀 내보내기/가져오기)·직원(월별급여/휴가관리)·수납(엑셀 내보내기/청구서 생성)·
  성적 상세(수정/삭제) 헤더를 전부 `Button` 기본 크기로 통일.

> **한 줄 규칙: 한 액션 행의 버튼은 공용 `<Button>` 기본 크기로 통일(색=variant만 차이). 손깎은 text-xs 링크·`size="sm"`를 1차 버튼 옆에 두지 말 것.**

### 저장 버튼 = 창 하단 고정 sticky 바 + 미저장 닫기 가드 (⚠️ 창 데이터입력 폼 기본값, 2026-07-03)
창(iframe)으로 열리는 **데이터 입력 폼**(생성/수정)은 저장 버튼이 폼 맨 아래에 있어 긴 폼일수록 스크롤해야 눌렀다(사용자
제보: "위치가 다 제각각"). **모든 창 폼의 저장 액션은 우하단에 sticky로 고정**해 스크롤 위치와 무관하게 항상 보이고,
같은 위치라 창마다 헷갈리지 않는다. + **작성 중(dirty)인 폼의 창을 닫으면(X/Esc) "저장하지 않고 닫을까요?" 확인**.
- **저장 바** = [`<FormActionBar>`](src/components/forms/form-action-bar.tsx)(sticky bottom-0 z-20, 우측정렬 backdrop-blur).
  폼의 제출 버튼(들)을 이 바로 감싼다. 손깎은 `justify-end border-t pt-N` footer는 이걸로 교체. 1·2차 버튼은 위 "버튼 크기" 규칙대로 바 안에.
- **미저장 닫기 가드** = [`useUnsavedGuard({ formRef, enabled? })`](src/components/workspace/use-unsaved-guard.ts) → `{ markSaved }`.
  · **전달 = iframe→부모 postMessage**(`eywa-window-dirty`) — winId를 경로로 추측하지 않고 부모([workspace-canvas](src/components/workspace/workspace-canvas.tsx))가
    `event.source`(=이 iframe의 contentWindow)를 iframeRegistry와 대조해 **정확한 창**을 찾는다(드릴인·복제창·새 창 안전). [[#69]]
  · dirty는 `serializeForm(formRef)` ↔ 마운트 baseline 비교. **저장 성공 확정 후 `markSaved()`** 호출(baseline 재스냅샷+dirty 해제 → 저장하고 닫아도 거짓 확인 안 뜸).
  · 부모 [floating-window](src/components/workspace/floating-window.tsx) `requestClose`가 `dirty[win.id]`면 확인 오버레이(계속 작성/저장 안 함, 닫기). Esc가 확인을 되돌린다.
- **적용 5단계**(레퍼런스 [student-form](<src/app/(shell)/students/_components/student-form.tsx>)): ① `const formRef=useRef` + `<form ref={formRef}>`(동시편집 가드가 이미 쓰면 재사용)
  ② `const {markSaved}=useUnsavedGuard({formRef})` ③ 제출 버튼을 `<FormActionBar>`로 감쌈 ④ **저장 성공(nonce/ok) effect에서 `markSaved()`** ⑤ effect deps에 markSaved.
- **적용 현황(2026-07-03)**: ✅ student·staff·class·consultation(학생상담)·enrollment 등록상담(full-form)·owner section-form + resume-sheet(편집 시 하단 바, 뷰 툴바는 인쇄/삭제만).
  ⏭️ 제외(구조가 다름) = 시험 batch-score-grid(상세 페이지 하위 섹션)·수강료 계산기(다패널 견적, 컨트롤드 state)·exam-form-dialog(모달, 자체 취소/저장).
- **⚠️⚠️ 컨트롤드 입력이 hidden input에 값을 미러하는 폼**(학원설정 section-form의 `data` jsonb·등록상담 과목점수 `subjectDetails`)은
  **React 커밋이 네이티브 `input` 리스너보다 늦어** 즉시 `serializeForm`하면 stale을 읽어 dirty를 놓친다 → 가드가 **`setTimeout(0)`으로 미뤄 커밋 후 비교**(적대리뷰 HIGH). 새 컨트롤드-미러 폼도 이 경로로 자동 커버 + **값을 hidden input에 반드시 미러**해야 스냅샷이 본다.
- **알려진 한계(수용, 데이터손실 경고는 유지)**: `배경으로 보내기`·창→배경 드래그·창 6개 초과 축출은 앱 확인을 안 거쳐 dirty 폼을 파괴할 수 있으나 드물고 의도적 제스처
  라 문서화만(기존 동시편집 가드도 미커버). 창 자체 하드리로드(⟳)·브라우저 back(전체 네비)은 iframe 네이티브 `beforeunload`가 뜬다(데이터손실 경고라 무해). 진짜 실시간 충돌방지(낙관적 동시성)는 별개.

> **한 줄 규칙: 창 폼의 저장은 `<FormActionBar>`(우하단 sticky)로, 미저장 닫기는 `useUnsavedGuard({formRef})`+저장성공시 `markSaved()`. 컨트롤드 값은 hidden input에 미러(가드가 setTimeout(0)로 커밋 후 읽음).**

### 줄바꿈 / 워드브레이크 — 한글 어절 단위 (⚠️ 전역, 좁은 창에서 특히 중요)
**텍스트가 "발표·세미 / 나" 식으로 단어 한가운데서 깨지지 않게 한다.** 플로팅 창은 폭이 좁아
(기본 480px) 이런 "얼토당토 않은 곳에서의 줄바꿈"이 흉한 뷰를 만든다. 전역 규칙이 기본을 잡는다:
- **`globals.css`의 `body { word-break: keep-all; overflow-wrap: anywhere; }`** — `keep-all`은 CJK를
  글자 사이에서 끊지 않고 **공백(어절) 경계에서만** 줄바꿈 → 한글이 자연스럽게 단어 단위로 접힌다.
  `overflow-wrap: anywhere`는 URL·긴 영문 같은 끊을 곳 없는 토큰이 넘칠 때만 강제로 끊는다. **새 화면은
  별도 클래스 없이 이미 이 동작**(옵트인 아님).
- **절대 쪼개지면 안 되는 인라인 조각**(라벨·배지·Pill·버튼 텍스트·날짜/시각·"N개 발화" 같은 메타)은
  **`whitespace-nowrap`**(flex 안이면 `shrink-0` 동반)을 붙인다. `keep-all`도 공백은 끊으므로 "AI 분석"
  처럼 공백 든 짧은 라벨은 nowrap 없으면 "AI / 분석"으로 깨진다(회의 상세 AI 헤더가 이 케이스였음).
- **좁은 창 헤더에 라벨 + 긴 부제 + 메타를 한 줄에 욱여넣지 말 것.** 긴 부제(예: 회의 유형)는 **자기
  full-width 줄로 내려** keep-all로 깔끔히 접히게 한다(라벨/메타는 윗줄에 nowrap으로 고정).
- **긴 본문에는 `whitespace-nowrap` 금지**(가로 오버플로 유발) — keep-all에 맡긴다. `truncate`/`line-clamp`는
  "한 줄/N줄 자르고 …" 의도일 때만.

### 학교·학년 표기 = `schoolGradeLabel` 압축 — "경명여중1" (⚠️ 전역, 학교+학년을 함께 쓰는 모든 곳, 2026-07-08)
**학교와 학년을 나란히 보여줄 땐 공백 join("경명여중 중1")이 아니라
[`schoolGradeLabel(school, grade)`](../src/lib/format/school-grade.ts)로 압축한다: "경명여중"+"중1" → "경명여중1",
"옥산초"+"초3" → "옥산초3".** ijw 시절부터 쓰던 표기(시간표 셀·hover 카드 `formatSchoolGrade(numberLast)`)인데
규칙 문서가 없어 새 화면들이 공백 join으로 회귀했었다(2026-07-08 사용자 재교정 — 역동기화 카드·견적서·수업리포트
인쇄·검색 등 7곳 일괄 통일).
- 한쪽만 있으면 그것만("침산중" / "중1"), 둘 다 없으면 `""` 반환 → 호출부의 `|| "—"` 폴백이 그대로 동작.
- 시간표 셀 전용 "5칠성초"(숫자 앞) 형식은 `formatSchoolGrade` 기본 변형 — ijw 완전 일치 필수라 변경 금지.
- 데이터(DB의 school·grade 컬럼)는 그대로 분리 보관 — 이건 **표시** 규칙이다. 엑셀 내보내기처럼 별도 컬럼이
  이미 있는 표면은 대상 아님.

> **한 줄 규칙: 학교+학년을 함께 표시하면 무조건 `schoolGradeLabel` — "경명여중 중1" 같은 공백 join을 새로 만들지 말 것.**

### 드래그-팬 (잡고 끌기) — 넘치는 영역의 기본 인터랙션 (⚠️ 새 화면 기본값)
**가로/세로로 넘치는 영역은 막대 스크롤바에만 의존하지 말고, 마우스로 빈 곳을 끌어 내용을
움직일 수 있게 한다** — 태블릿/지도 앱 느낌(놓으면 관성 글라이드 + 넘치는 가장자리 페이드).
구현체: [`src/components/ui/drag-scroll-area.tsx`](src/components/ui/drag-scroll-area.tsx)의 `<DragScrollArea>`.
- **적용**: 기존 `<div className="… overflow-auto …">{내용}</div>` →
  `<DragScrollArea className="… (overflow-auto 빼고)">{내용}</DragScrollArea>`.
  안쪽 컨테이너가 overflow를 담당하므로 바깥 className에서 `overflow-auto`는 뺀다.
- **양축 자동**: 넘치는 축만 팬. 안 넘치면 grab 커서·페이드 자동 off.
- **충돌 안전**: 터치는 네이티브 스크롤에 위임, dnd-kit draggable(`[aria-roledescription="draggable"]`)·
  폼 컨트롤 위에선 팬을 시작하지 않는다. 5px 임계값으로 "탭=클릭 / 끌기=팬"을 구분하고, 실제로
  끌었으면 뒤따르는 click 1회를 차단(카드·링크 오작동 방지). 팬을 막을 자식엔 `data-no-drag-scroll`.
- 전역 스크롤바 하네스와 **병행** — 스크롤바는 그대로 보이고 드래그가 더해질 뿐. 새 화면에서
  넓은 표·캔버스·가로 목록을 만들 땐 처음부터 `DragScrollArea`로 감쌀 것.

### 플로팅 창 기본 크기 — 넓은 메뉴는 크게 연다
메뉴는 플로팅 창(크롬리스 iframe)으로 열리고 기본 480×560인데, 넓은 표는 거기 안 들어가 가로
스크롤이 과해진다(#24). **넓은 메뉴는 크게 연다** —
[`src/components/workspace/window-geometry.ts`](src/components/workspace/window-geometry.ts)의
`ROUTE_WINDOW_SIZE: Record<menuKey, {w,h}>`에 등록(없으면 `DEFAULT_WINDOW`). 캔버스보다 크면
`cascadeNext`가 자동 clamp(작은 화면 안전). 예: `timetable: { w: 1040, h: 680 }`.

### 다열 보드 = 큰창 그리드 / 작은창 탭 (⚠️ 칸반형 레이아웃 기본값, 2026-06-19)
플로팅 창은 기본 480px로 좁다. **여러 독립 컬럼을 가로로 늘어놓는 보드(칸반)** 를 좁은 창에서 그냥
1열로 떨구면 컬럼들이 세로로 쌓여 "다른 컬럼 보려고 한참 스크롤"하는 흉한 뷰가 된다(등록상담 제보).
**해법: 창이 넓으면(lg≥1024px) N열 그리드로 전부 펼치고, 좁으면 상단 탭바로 컬럼을 전환해 한 번에
1개만 보인다.** 창=iframe이라 Tailwind `lg:` 브레이크포인트가 **창 폭에 그대로 반응** → 같은 창을
리사이즈/스냅하면 "큰창=그리드 ↔ 작은창=탭"이 라이브로 바뀐다(JS 미디어쿼리 불필요, 활성 탭 state만
클라이언트가 소유).
- **레퍼런스 구현**: [`enrollment/_components/enrollment-kanban.tsx`](<src/app/(shell)/enrollment/_components/enrollment-kanban.tsx>).
  서버 페이지는 컬럼별 데이터(`{key,label,color,cards}[]`)만 만들어 넘기고, 이 클라이언트 컴포넌트가
  탭 state·아이콘·렌더를 소유.
- **핵심 클래스 레시피**: ① 탭바 컨테이너 `flex overflow-x-auto lg:hidden`(좁을 때만), 활성칩은 보드
  필터 톤과 통일(`bg-foreground text-background`). ② 그리드 `grid grid-cols-1 lg:grid-cols-N`.
  ③ 각 컬럼 카드 `lg:flex ${i===active ? "flex" : "hidden"}` — 좁을 땐 활성 1개만, lg부턴 전부.
- **적용 기준(=칸반일 때만)**: 컬럼들이 **동등·독립한 평행 목록**일 때만 맞다(상태별 보드 등).
  - ✅ 칸반(등록상담: 대기·예약 / 상담완료 / AI완료 / 등록·종료).
  - ❌ **동질 카드 그리드**(수업목록·직원 `lg:grid-cols-3`)는 탭 아님 → **목록 페이지네이션** 표준으로.
  - ❌ **상세 본문+사이드 분할**(`lg:grid-cols-3`의 1.5+1 류)은 그냥 세로로 쌓이면 됨.
  - △ 약한 후보: `/retention`(이탈 방어) 2열 대시보드(`lg:grid-cols-[1.5fr_1fr]`) — 필요해지면 적용.
- 2번째 칸반이 생기면 그때 제네릭 컴포넌트로 추출(지금은 단일 사용처라 등록상담에 인라인).

### 영역 구분 — 이질적 다(多)섹션은 헤더 달린 카드로 또렷이 나눈다 (⚠️ 상세/집계 뷰 기본값, 2026-06-24)
**성격이 다른 정보 묶음을 한 화면에 모을 때 밋밋한 나열/벽으로 두지 말고, 각 묶음을 시각적으로 또렷이 구분한다.**
밋밋하면 "다 비슷해 보여 어디가 어디인지 모르겠다"가 된다(등록상담 AI 13섹션이 한 카드 안에 불릿으로 쏟아져 제보된 케이스).
레퍼런스 구현: [`(shell)/enrollment/[id]/page.tsx`](<src/app/(shell)/enrollment/[id]/page.tsx>) — 좌 "상담 기록"(입력) ↔ 우 "상담 AI 분석"(녹음 분석).

**규칙(이질적 다섹션일 때):**
- **섹션 = 헤더 달린 단일 카드**: `bg-card border-line rounded-md border p-4` + 헤더(이모지/아이콘 + 굵은 라벨 13px). 공용 `Card({title, emoji})`.
  ⚠️ 별도 음영 헤더 바를 content 위에 얹은 **"이중 박스" 금지**(단일 박스 안에 헤더+본문). 한 화면의 카드는 **모두 같은 클래스**로(좌우 통일).
- **평행 그룹엔 그룹 제목으로 대칭**: 좌/우 열처럼 성격이 다른 묶음은 각 묶음에 **그룹 제목**(아이콘+제목)을 달아 대칭. 한쪽만 제목이면 비대칭=혼란.
- **데이터는 성격대로 배치**: 입력 데이터는 입력 그룹, 분석 결과는 분석 그룹(예: "과목별 점수"=입력이라 분석 열→입력 열로 이동). 출처가 다르면 배지로(예: `학부모 직접 제출`).
- **리스트형 섹션은 불릿**([RichText](src/components/rich-text.tsx) `bulletize`), 산문 섹션은 문단.

**⚠️ 과적용 금지 — 케이스가 다른 곳(여기엔 적용하지 말 것):**
- **동질 목록**(학생·수납·상담 목록 등): 한 행=한 카드로 박지 말 것 → **목록 페이지네이션** 표준(아래) 사용.
- **밀집 그리드**(시간표 매트릭스·출석부 30일): 셀을 박스로 나누지 말 것 → 그리드/엑셀격자 자체 처리.
- **단일 폼/단일 콘텐츠**: 섹션이 1~2개뿐이면 카드 분리가 오히려 노이즈·무거움. 나눌 게 있을 때만 나눈다.
- **칸반형 평행 컬럼**: 이미 위 "다열 보드" 규약으로 영역 구분됨 — 그걸 따른다(중복 적용 X).

> **한 줄 규칙: 이질적 다섹션 = 헤더 카드로 또렷이 + 평행 그룹은 대칭 제목. 동질 목록·밀집 그리드·단일 콘텐츠엔 적용 금지.**

**적용 현황(2026-06-24 전수 서베이 15화면 → needs 5곳만, 케이스 구분):** ✅ 적용 = 등록상담 상세(레퍼런스, 좌 상담기록↔우 AI분석)·
반 상세(좌 반정보↔우 수강중인학생)·퇴원 상세(수강이력 카드 통일)·강사 원스크린(중앙/우측 그룹 제목)·회의록 상세(원본노트 카드)·
도움말(동질 메뉴 13개 개별카드→한 컨테이너 리스트 = **과적용 제거 사례**). ⏭️ 제외 = 학생/직원 상세·대시보드·my-learning·분석
대시보드(이미 카드 양호/경계)·시험상세·시간표·출석부(밀집 그리드)·이탈방어(동질 목록)·owner/billing(FaceTabs)·각종 목록(페이지네이션)·폼.

### 반응형 창 폭 — 넓은창 공간활용 + 좁은창 접힘 (⚠️ 새 페이지 기본값, 2026-06-19)
모든 (shell) 페이지는 크롬리스 iframe(플로팅 창)에서 렌더되고, 창은 **360px(MIN_W) ~ 최대화 시
전체폭(~2300px)** 까지 자유 리사이즈/스냅된다. **창=iframe이라 Tailwind 브레이크포인트
(sm 640 / md 768 / lg 1024 / xl 1280)가 창 폭에 그대로 반응** → 같은 창을 리사이즈하면 레이아웃이
라이브로 바뀐다(미디어쿼리·JS 불필요). 그래서:
- ⚠️ **고정 좁은 `mx-auto max-w-4xl` 중앙정렬은 안티패턴** — 창을 최대화하면 콘텐츠가 그 폭에 갇혀
  좌우 여백이 수백 px씩 비고, 그 안에서도 열이 안 늘어 단일 입력칸만 비대해진다(owner 학원설정이 주범이었음).
- **원칙: 넓은 창은 여백 대신 "열/콘텐츠"로 채우고, 좁은 창(sm 미만)은 단일 컬럼으로 접는다.** max-w를
  막연히 키워 단일 입력이 가로로 폭주하게 두지 말 것.

**pageType별 처방:**
- **설정(탭형 다카드)** = 좌측 세로탭 + 우측 본문 **마스터-디테일**: 바깥 `lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8`,
  nav는 좁으면 상단 가로탭(`flex flex-wrap … lg:flex-col`), 섹션 카드는 `grid gap-4 xl:grid-cols-2`로 펼침.
  **레퍼런스: [owner-console.tsx](<src/app/(shell)/owner/_components/owner-console.tsx>)** (페이지 캡 `max-w-7xl`).
- **설정(비탭 다카드, 예 kiosk-settings)** = `grid gap-6 lg:grid-cols-2 lg:items-start` + `max-w-5xl`(헤더는 그리드 밖 full-width).
- **단일 입력만 있는 폼**(meetings/new, sheets 연결) = 오히려 **`max-w-xl~2xl`로 좁혀 가둔다**(열 늘릴 콘텐츠가
  없어 안 좁히면 한 줄 입력이 폭주). admin/cleanup처럼 짧은 카드 스택은 `grid md:grid-cols-2 xl:grid-cols-3`.
- **데이터 입력 폼**(학생/직원/반/상담) = 필드로 꽉 찬 중앙 `max-w-4xl`는 **OK**(희박한 낭비 아님 — 그대로 둠).
  더 채우려면 필드 grid를 `sm:grid-cols-2 xl:grid-cols-3` / `sm:grid-cols-3 xl:grid-cols-4`로(cap는 유지).
- **list / detail / dashboard** = full-width + `grid lg:grid-cols-[…]` 마스터-디테일(**이미 정석, 손대지 말 것**).
  넘치는 표는 막대스크롤만 두지 말고 **[`DragScrollArea`](src/components/ui/drag-scroll-area.tsx)** 로 감싼다
  (`<div className="… overflow-auto">표</div>` → `<DragScrollArea className="…(overflow-auto 뺀)">표</DragScrollArea>`).
- **student-screen / print / 단일 키패드** = 의도적 `mx-auto max-w-[680~768px]` 유지(읽기 흐름·단일 입력). 넓은창 여백 정당.

**좁은 창(360~480px) 체크리스트** (새 페이지 추가 시 필수):
- 모든 다열 grid가 sm 미만에서 `grid-cols-1`로 접히는가(기본 `grid-cols-1` 명시).
- 편집 헤더(타이틀 + 삭제/이동 버튼)는 `flex flex-wrap items-end justify-between gap-3`(안 그러면 360px서 한 줄에 낌).
- 버튼 그룹(상태칩 등)도 `flex-wrap`(출석 입력폼 6버튼 케이스).
- 가로 오버플로는 BREAKS가 아니라 `DragScrollArea`/`overflow-x`로 흡수(전역 스크롤바 하네스와 병행).

⚠️ **새 설정·폼 페이지를 만들 때 이 규약을 점검** — 특히 `mx-auto max-w-Nxl` 중앙정렬을 기본으로 박지 말 것.
같은 "큰창=펼침 / 작은창=접힘" 패러다임의 칸반 버전은 위 "다열 보드" 섹션 참고.

### 생성 폼은 우측 패널이 아니라 창으로 — autoClose 창 (⚠️ "새 X" 진입점 기본값, 2026-06-19)
"새 반/직원/학생/등록상담/상담/회의록" 같은 생성 폼은 우측 슬라이드 `<Sheet>`를 **쓰지 않는다**. 이미 있는
`/X/new` 라우트를 **플로팅 창**으로 연다(윈도우 패러다임 일관). 트리거는 기존 버튼 마크업을 그대로 두고
[`useOpenFormWindow()`](src/components/workspace/open-window-button.tsx)로 `openFormWindow("/X/new", "제목", e)`만
호출(데스크톱=창, 모바일=풀페이지 네비). 창은 `WindowParams.autoClose`로 열려, iframe이 `/X/new` 경로를
**벗어나면**(=제출 성공 후 서버 `redirect` 또는 `router.push`) RouteWindow가 **창을 닫고 배경을 새로고침**한다
(옛 패널의 "닫고 목록 갱신"과 동일 — 서버액션·폼 로직 수정 0). `ROUTE_WINDOW_SIZE`에 `"X/new"` 폭 등록(옛 패널 폭 계승).
- ⚠️ 콘텐츠용 우측 슬라이드 `<Sheet side="right">`는 **신규 추가 금지** — 창으로 연다. (`Sheet`는 모바일 내비
  드로어 등에 한정.) ⚠️ **정정(2026-06-24 배선 감사)**: `students/_components/student-quick-panel`(+`components/student-quick-popover`)은
  "모바일 peek 폴백 잔존"이라 적혀 있었으나 **실제로는 어디서도 import 안 되는 dead 컴포넌트**(미연결). 제거/재연결은 백로그([`docs/audit-log.md`](docs/audit-log.md)).
- 한계: 배경(메인 프레임) 목록은 `router.refresh()`로 갱신되지만, 목록이 **별도 창**이면 그 창은 즉시
  갱신되지 않음(창 X 버튼 `closeAndRefresh`와 동일한 앱 전반 한계).

### 동시편집 "수정중" 실시간 표시 — cross-user presence (⚠️ 편집 표면 기본, 2026-07-01)
같은 레코드를 두 사람이 동시에 수정 → 마지막 저장이 앞을 덮어쓰는 유실을 **목록 배지 + 폼 배너로 예방**(soft 표시,
하드 잠금 아님). 기존 [`useConcurrentEditGuard`](src/components/workspace/use-concurrent-edit-guard.ts)(BroadcastChannel)는
**같은 브라우저**만 잡으므로, **다른 사람/기기**는 **Supabase Realtime Presence**로(스키마 0·ephemeral·이미 켜진 Realtime 재사용).
- **인프라** [`features/presence/`](src/features/presence): `presence-state.ts`(순수 — presenceState→scope별 편집자,
  **내 presence key 제외**[같은 계정 다른 탭도 표시]·allowlist **콜론 매칭**[`student:`가 `student-consultation:`을 오매칭 안 함]·
  dedupeEditors, Vitest 8) · `edit-presence.tsx`(테넌트 단일 채널 `edit-presence:${tenantId}`, `EditPresenceProvider`+
  `useEditingOthers`/`useEditPresence`. `useSyncExternalStore` scope단위 구독·**refcount Map**[같은 문서 2컴포넌트 안전]·
  myKey는 effect 내 생성[렌더 순수성]) · `editing-badge.tsx`(`EditingBadge` 앰버·`EditingBanner` 폼 경고, userId dedupe).
- **scope = 기존 가드 scope 재사용**: `student:${id}`·`class:${id}`·`staff:${id}`·`consultation:${id}`(등록상담)·
  `student-consultation:${id}`·`meeting:${id}`·`tenant-settings:${section}` → 배지·폼·가드 자동 매칭.
- **쓰기**: `useConcurrentEditGuard`에 `useEditPresence(scope,!!scope)` 통합(**항상 호출**·allowlist는 훅 내부) → 학생·반·직원·
  설정 폼 자동. 미배선 폼(등록상담 [consultation-full-form](<src/app/(shell)/enrollment/_components/consultation-full-form.tsx>)·학생상담) 가드 추가.
  회의 **3 편집 표면**(제목·AI보고서·화자) `useEditPresence`. 폼 상단 `EditingBanner`.
- **읽기**: `EditingBadge` 목록 인라인(등록상담 칸반/테이블·학생·수업·직원·회의·학생상담) — 서버 컴포넌트에도 클라 아일랜드로.
  [`layout.tsx`](<src/app/(shell)/layout.tsx>) 3경로에 `EditPresenceProvider`.
- ⚠️ **[배포 전 결정] 채널 보안**: v1 public 채널(코드 TODO). 프로덕션 전 `private:true` + `realtime.messages` RLS 결정.
  presence=이름·scope만 노출(저민감)·ephemeral(감사로그 아님)·**soft**(last-write-wins 못 막음 → 진짜 충돌방지는 `updated_at`
  낙관적 동시성=후속). 창(iframe)마다 채널 구독(멀티윈도우 비용). 기존 same-browser 저장경고와 공존.
- 검증: typecheck0/lint0/**test584**(presence-state 8). ⚠️ Realtime presence는 2-브라우저 수동 E2E(단위테스트 부적합).
- ⚠️ **커밋 분산**: 인프라·배선·배지는 `cb3d8f6`(main), 등록상담 폼 배선은 병렬 세션이 폼 재구조화 커밋(`7c1456e`)에 함께 포함(내 working 변경을 흡수).

### 강사 접근 조임 — 강제 URL = roleHome 폴백 (2026-07-01, `84199c4`)
강사가 `/dashboard`를 강제 URL로 열면 **owner 대시보드(테넌트 전체 재무: 미수·수납률 등)** 가 보이던 intra-tenant 누수 수정.
- **MENU_ACCESS 강사 = none**([permissions.ts](src/lib/permissions.ts)): `dashboard`·`withdrawals`·`staff`·`meetings`. 전부
  테넌트 전역 + 강사 스코핑 없음 + 강사 의도 메뉴(원스크린 + 담당 교육 페이지)에도 없던 항목. (강사가 계속 쓰는 학생·출석·
  수업·성적·상담·시간표는 스코핑된 채 유지.)
- **`roleHome(role)` 단일 소스**(강사=/onescreen·학생=/my-learning·그 외=/dashboard-or-/) + [`requireAccess`](src/lib/auth/require-access.ts)가
  **거부 시 roleHome으로 폴백**(기존 무조건 /dashboard → 강사가 대시보드로 새던 경로 차단). 강사/학생 홈은 ROLE_LOCKED라 루프 없음.

### 로컬 초안 자동저장 — 길게 입력하는 폼은 입력 중 유실 방지 (⚠️ 긴 폼 기본값, 2026-06-30)
"한참 입력하다 창을 닫거나 새로고침하면 통째로 날아가는" 긴 폼(등록상담·학생·직원·학생상담 등)은 **입력 중 로컬(IndexedDB)에
자동 보관**하고 다시 열면 복구한다. "실제 저장"(서버 커밋)은 기존 그대로 — 초안은 유실 방지/이어쓰기용일 뿐 **서버에 안 보낸다**.
- **인프라**: [`useFormDraft({ scope, formRef, enabled?, onRestore?, exclude?, ignoreForBanner? })`](src/components/forms/use-form-draft.ts)
  (입력 700ms 디바운스 → IDB 저장, 다시 열면 `draftSavedAt` 세팅) + [`<DraftBanner savedAt onRestore onDiscard />`](src/components/forms/draft-banner.tsx)(공용 복구 배너)
  + [`form-draft.ts`](src/lib/form-draft.ts)(`readFormValues`/`applyFormValues`/`hasMeaningfulValues` — **DOM 일괄 캡처/복원**). 녹음 IDB 복구와 같은 패턴, **별개 레이어**(둘 다 동작).
  + **상태 기반 변형** [`useStateDraft({ scope, snapshot, hasContent })`](src/components/forms/use-state-draft.ts) — 입력이 `<form>` DOM이 아니라 **React state(동적 배열)** 인 폼용(수강료 계산기). 직렬화 가능한 `snapshot`을 통째로 JSON으로 디바운스 저장, `restore()`가 파싱본을 돌려주면 호출부가 setState로 rehydrate.
- **적용 5단계**(레퍼런스 [consultation-full-form.tsx](<src/app/(shell)/enrollment/_components/consultation-full-form.tsx>)):
  ① `const formRef = useRef<HTMLFormElement>(null)` + `<form ref={formRef}>` (동시편집 가드가 이미 formRef를 쓰면 **재사용**).
  ② `const draft = useFormDraft({ scope: mode==="create" ? "x:new" : ` + "`x:${id}`" + ` })`. ③ 폼 첫 자식에 `<DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />`.
  ④ **서버 저장 "성공 확정 후"에만 `draft.clear()`** — `state.ok && state.nonce` effect 안에서(B-2). ⚠️ **`<form onSubmit={()=>void draft.clear()}>`(제출 시점 무조건 clear) 금지** — 서버 검증
  실패해도(폼 화면에 남는데) 초안이 먼저 지워져 창 닫으면 복구 불가(2026-06-30 학생상담서 버그). ⚠️ **create 액션이 `redirect()`면 NEXT_REDIRECT throw로 nonce effect가 영영 안 돌아 'x:new' 초안이 안
  비워진다** → create 액션도 update처럼 **`return { ok:true, redirectTo, nonce: Date.now() }`**(redirect 금지)로 통일해 nonce effect가 create/edit 공통 발화하게 한다. 클라 onSubmit로 액션을 직접 await하는 폼(등록상담 create)은 **`catch`의 `if(/NEXT_REDIRECT/.test(msg)){ clearDraft(); return; }`** 분기에서 clear(네비는 프레임워크).
  ⑤ scope는 **폼마다 고유 접두**(등록상담 `consultation:*` ↔ 학생상담 `student-consultation:*` — 같으면 IDB 초안을 서로 덮어씀).
- **⚠️ 캡처 규칙**: DOM의 **name 가진** input/select/textarea/checkbox만 캡처/복원된다. 그래서 ―
  · **컨트롤드 React state**(과목점수 jsonb·반 색·SearchableSelect 등)는 자동복원 안 됨 → **hidden input(name)로 직렬화**돼 있어야 캡처되고, **`onRestore`로 setState rehydrate**(레퍼런스 subjectDetails 패턴). 신뢰 안 되면 `exclude`로 빼고 사용자 재입력(학생상담 studentId).
  · **비밀번호·서버 prop·봇 트랩**(직원 임시비번·공개접수 renderedAt/company/token)은 `exclude`로 **IDB에 안 남기기**(보안).
  · **기본값이 항상 채워지는 필드**(상담 일시 now·category·audience 등)는 `ignoreForBanner`로 빼서 **빈 폼 오탐 배너** 방지.
- **적용 현황(2026-06-30)**: ✅ 등록상담·학생(생성/수정)·직원·학생상담 + **수강료 계산기**(`useStateDraft` 스냅샷)·**반**(class-form: 스케줄 grid hidden input
  schedule_*_${i}를 onRestore에서 배열로 복원 → `key`로 ScheduleGrid remount + 과목/담임/색 setState)·**지출**(2026-07-01, expense-dialog — 하이브리드: DOM 필드 자동 캡처/복원 + 라인아이템·통화는 onRestore로 setState;
  빈 항목이면 hidden `lineItems`를 `""`로 정규화[액션 parse는 `""`·`"[]"` 동치=null]해 오탐 배너 방지, `ignoreForBanner`=분류/일자/합계/통화; 다이얼로그 조건부 마운트라 성공 시 clear+onClose 안전). ⏳ **SPECIAL 남음** = 학부모 QR 공개접수(uncontrolled DOM + 다중선택/false·null
  lossy state 혼합 → 하이브리드)·학원설정(제네릭 래퍼라 각 *-section이 직접 useFormDraft 또는 onRestoreDraft 콜백 필요) — 별도 패스. ⏭️ **skip** = 짧은 폼(시험 등록·회의 신규·성적 인라인·상담 녹음[녹음은 이미 복구]).
- ⚠️ 새 "긴 폼"을 추가하면 이 5단계로 초안 자동저장을 붙인다. 컨트롤드/동적 state가 있으면 hidden 직렬화+onRestore를 잊지 말 것(안 그러면 복원이 반쪽).

### 인쇄(Print) — 인쇄 버튼이 있는 모든 곳은 플로팅 창 + A4 (⚠️ 새 인쇄 표면 기본값, 2026-06-24)
**인쇄 버튼이 달린 모든 곳은 새 브라우저 탭이 아니라 eywa 플로팅 창으로 열고, 결과는 항상 A4로 깔끔히 인쇄된다**
(멀티윈도우 정체성 일관 + 여러 학생 요청서 동시 비교). 플로팅 창=same-origin iframe이고 `window.print()`는 **그 iframe
문서만** 인쇄하며 **창 타이틀바는 부모 프레임에 있어 인쇄에 안 섞인다**(계산기 안내문으로 검증). 인쇄 표면 = 등록상담
인수인계서·회의록·교재요청서(전용 `(print)` 라우트) + 수강료 안내문·지출결의서(이미 창인 in-place `window.print()`).

- **진입점 = [`PrintWindowButton`/`usePrintWindow`](src/components/workspace/print-window.tsx)** (데스크톱=플로팅 창, 모바일=풀페이지).
  **raw `<a target="_blank">` 새 탭 금지.** ⚠️ 창 id는 **명시 `print/<type>/<recordId>`** 로 준다 — `windowIdForHref`가 만드는
  `enrollment/123/print`는 [`routeWindowSize`](src/components/workspace/window-geometry.ts) longest-prefix가 못 잡아 DEFAULT(480×560)로 떨어진다.
  `print/<type>` prefix면 [ROUTE_WINDOW_SIZE](src/components/workspace/window-geometry.ts)에 등록한 A4 세로 크기(`print/enrollment`·`print/meetings`·`print/textbook`)로 매칭.
- **세로 문서 = 루트에 `print-portrait` 클래스.** globals.css의 전역 `@page { size: A4 landscape }`(시간표용)를 `@page portrait-doc`로
  덮어쓴다(opt-in). 시간표는 기본 landscape(인쇄 버튼 현재 없음 — 범위 밖). 비문서 크롬(액션바·FaceTabs·뒤로가기)은 `print:hidden`.
- **전역 인쇄 하네스(globals.css `@media print`)**: 셸/임베드 `<main>`이 `h-screen + overflow-auto`라 인쇄 시 문서를 **한 화면
  높이로 잘라** 2페이지째(예: 환불 규정)가 통째로 사라진다 → `html/body/main`에 `height:auto`·`overflow:visible`·`max-height:none`
  리셋으로 자연 페이지 흐름. (이 리셋 없으면 긴 문서 2페이지째 클리핑.)
- ⚠️ **통짜 `break-inside-avoid` 금지** — 한 페이지보다 높은 섹션에 걸면 통째로 다음 장으로 밀려 1페이지 하단 공백/잘림. 표는
  전역 `tr/td/th { page-break-inside: avoid }`가 **행 단위**로 보호 → 섹션 통짜 회피는 불필요·역효과. 제목 고아만 `break-after-avoid`.
- **닫기 버튼**: 인쇄 라우트의 `window.close()`는 iframe(창) 안에서 무효 → 인쇄 페이지(서버)가 `headers().get("x-embed")`로
  `embedded`를 판별해 prop으로 내려 **embedded면 닫기 숨김**(창 X로 닫음). 인쇄/이미지저장은 유지.
- **새 인쇄 표면 5체크**: ① `(print)` 라우트 또는 이미 창인 문서 ② 루트에 `print-portrait` ③ 비문서 `print:hidden`
  ④ `PrintWindowButton`(id `print/<type>/<id>`) + `ROUTE_WINDOW_SIZE`에 `print/<type>` A4 등록 ⑤ 통짜 `break-inside-avoid` 금지.

> **한 줄 규칙: 인쇄 버튼은 `PrintWindowButton`(id `print/<type>/<id>`)로 플로팅 창을 열고, 문서 루트엔 `print-portrait`, 통짜 break-inside-avoid 금지.**

### 목록 페이지네이션 표준 — 큰 목록은 전부 이 패턴으로 통일 (⚠️ 새 목록 기본값)
실데이터 이전 후 목록이 수백~천 행이 되며 페이지가 22s까지 느려졌다(전 행 fetch + 전 행 렌더).
**행이 수십을 넘을 수 있는 모든 목록은 서버 페이지네이션으로 통일한다.** 스타일·구조를 한 곳에
맞춰 학생·수납·상담이 동일하게 보이고 동작하도록:

- **공용 컴포넌트 = 페이저 표준 룩** [`src/components/pagination.tsx`](src/components/pagination.tsx)의 `<Pagination>` —
  **테두리 없는 `◀ 이전 / {page} / {totalPages}(· N건) / 다음 ▶` + hover 배경**(2026-06-30 통일). **인라인으로 nav를
  다시 짜지 말 것.** props: `page`, `totalPages`, `hrefForPage(p)=>string`, 선택 `total`(주면 "· N건" 표시).
  `totalPages<=1`이면 자동 null. (서버 컴포넌트끼리 함수 prop 안전.)
  - **클라이언트 state 페이저**(href 아닌 onClick, 예: 등록상담 칸반 [column-cards](<src/app/(shell)/enrollment/_components/column-cards.tsx>))는
    `<Pagination>`을 직접 못 쓰니, 같은 모듈이 export하는 **`PAGER_STEP_BASE`/`PAGER_STEP_ENABLED`/`PAGER_STEP_DISABLED`/`PAGER_LABEL`**
    클래스 상수로 버튼·라벨을 만들어 **시각을 동일하게** 한다(새 페이저는 native 버튼 손깎기 말고 이 상수 사용).
  - ⚠️ **페이지 이동 시 위치 고정**: 마지막(짧은) 페이지나 페이지별 내용 높이 차로 목록이 줄면 페이저가 위로 튄다.
    **클라 state 페이저(버튼이 커서 밑에서 움직임)는 목록 영역을 고정 높이로**(column-cards `h-[56vh] overflow-y-auto`).
    서버 href 페이저는 페이지 전환=리로드라 버튼이 커서 밑에서 안 움직여 영향이 작다.
- **쿼리 헬퍼 2종** (feature `server/queries.ts`):
  - `getXPage(filters, page=1, pageSize=50): Promise<{ rows, total }>` — Supabase `.range(from,from+size-1)`
    + `.select(cols, { count: "exact" })`. **필터는 가능한 한 SQL로** (eq/gte/ilike/or). 조인 컬럼
    검색은 별도 id 해석 후 `.or("base.ilike.%q%,fk.in.(ids)")` (상담 학생명 검색 참고).
  - **Stat 카드용 경량 집계** — 행을 fetch하지 말고 `.select("*", { count:"exact", head:true })`로 count만
    (학생 `getStudentStatusCounts`, 상담 `getStudentConsultationCounts`). 카드는 페이지가 아니라 **전체**
    기준이어야 하므로 페이지 rows에서 도출 금지.
  - 월 단위처럼 모집단이 이미 작으면(수납 ~400행/월) **한 번만 fetch 후 메모리에서 검색·슬라이스**해도
    됨(수납 `summarizeInvoices` + `filtered.slice`). 이중 fetch만 피하면 됨.
- **페이지 컴포넌트 표준 코드**:
  ```ts
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total }, counts] = await Promise.all([ getXPage(filters, page, PAGE_SIZE), getXCounts() ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p) => { /* 현재 필터 보존 + p>1일 때만 page= 세팅 */ };
  // 빈 상태 판정은 rows.length이 아니라 total === 0
  // …목록… <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
  ```
- **page 리셋 규칙**: 필터 chip·검색·정렬·월이동 href(`buildHref`/`buildSortHref`)는 **page 파라미터를
  넣지 않는다** → 자동으로 1페이지로. `pageHref`만 `p>1`일 때 `page=`를 세팅. "결과 N건"은 `total`
  (페이지 rows.length 아님), 옆에 `{page}/{totalPages} 페이지` 표기.
- **PAGE_SIZE = 50** 고정(표·카드 공통). 변경 시 전 목록 동시 변경.

---

