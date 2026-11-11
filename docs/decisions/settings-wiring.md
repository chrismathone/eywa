# 학원 설정 — 배선 현황·미구현

> CLAUDE.md '학원 설정'에서 옮긴 원문이다(2026-09-23).

### 배선 현황 (2026-06-19 Phase 1·2 픽스 후 — "동작 예시" 인용 시 ✅만)
- **✅ 배선 완료**: profile `name`·`branchLabel`·`logoText`, operations `subjects`·`jobTitles`·`gradeLevels`·
  `weekdayPeriods`·`weekendPeriods`·`holidays`, billing `dueDay`, notifications `printHeader` (기존) +
  **Phase 1·2 신규**: profile `brandColor`(layout가 `--primary` 등 CSS 변수 주입, `src/lib/color-utils.ts`),
  profile `representativeName`·`phone`·`email`·`address` + billing `latePolicy`(등록 인쇄물 푸터/안내,
  `(print)/enrollment/[id]/print`), notifications `alimtalkSenderKey`(kakao `pf_id` 지연 폴백, `messaging/provider.ts`)·
  `googleSheetId`(시트 동기 폴백, `integrations/server/{actions,queries}.ts`).
  - **(2026-10-01) `dashboard` 섹션(역할별 운영실 배치)**: 폼 = 학원 설정 > 대시보드 관리(`owner/_components/dashboard/*`, 원장·총괄만 · 저장 = `saveOwnerSection("dashboard")` → `normalizeDashboard({ dropDefaults })` · 감사로그 `diffDashboard` 역할마다 한 줄).
    소비처 = 운영실 서버 [`loadOverview`](src/features/dashboard/overview/server.ts)(`resolveView` → `loadPlan`이 조회할 영역을 정하고 `shapeSections`가 금액·전화번호·담당 과목을 비운다) + 화면 `Overview`/`GridBoard`(스냅샷의 `view`로 그린다).
    🔴 다른 파일이 `settings.dashboard`를 직접 읽지 말 것 — 권한 상한·기본 배치 폴백을 놓친다(`resolveView` 한 길). 기본 = 저장값 없음(`{ version: 1, layouts: [] }`).
  - **(2026-10-01) report `classnoteParentReplyMode`**(학부모 글 답글·공감 — 끔 기본·시험·전체): 폼 = 수업보고서 > 보고서 설정 > 발송(`classnote-reply-mode-field.tsx`).
    소비처 = 앱 [`classnoteReplyMode`](src/features/owner/classnote-gate.ts)(→ 벨 버튼 `getReplyTargetsForNotifications` · '학부모 글·답글' 면 `lessonReportFaces({replyOn})` · 서버 액션 첫 문 `replyGate`)
    + 연동 PC 워커 `loadReplyMode`(raw SQL 직독, 폴마다). 🔴 원시값 `report.classnoteParentReplyMode`를 다른 파일이 직접 읽지 말 것 — 모듈 꺼짐을 놓친다(가드 `reply-mode-wiring.test.ts`).
  - ~~⚠️ 영어 교시는 여전히 `ENGLISH_PERIODS` 하드코딩~~ → **✅ 해소(2026-07-06)**: 과목 운영 탭 `subjects[].weekdayPeriods`로 과목별 설정 가능(미설정=english 내장→전역 폴백).
  - **(2026-07-20) 비로그인(pre-auth) 표면도 배선 완료** — 로그인 화면·루트 탭 제목이 제품 기본값/하드코딩 "인재원"이던 것을
    [`getPublicBranding()`](src/features/owner/server/public-branding.ts)로 전환(profile `logoUrl`·`logoText`·`name`·`branchLabel` 소비).
    ⚠️ **로그인 전엔 세션이 없어 테넌트를 모른다** — 그래서 이 헬퍼는 "어느 지점"이 아니라 **회사 브랜드 학원** 하나를
    고른다(2026-09-18 갱신, 결정 로그 "멀티테넌트 URL = C안" 참조): 학원이 1개면 그 학원, 2개 이상이면 env
    `PUBLIC_BRAND_TENANT_SLUG`의 학원, 아니면 **null → 제품 중립 표기**(임의 선택 = 남의 학원 이름 노출). 지점을 알아야 하는
    비로그인 화면(자리 PIN)은 `listPublicBranchChoices`로 고르게 하고, 지점이 정해진 뒤엔 `getPublicBrandingByTenantId`.
    새 비로그인 화면에서 학원 브랜드가 필요하면 `getTenantSettings()`(세션 필요, 여기선 빈 값)가 아니라 **이 헬퍼**를 쓸 것.
  - **(2026-06-19) operations `subjects`/`gradeLevels` 하드코딩 소비처 전수 배선 완료(20건/17파일)** — 멀티에이전트
    전수감사로 "설정 무시" 위반 20건 적발·수정. 첫 발견은 학생목록·수업목록·성적관리 과목 드롭다운에 설정에 없는
    "예술(arts)" 누출(`SUBJECT_FILTERS`/`SUBJECT_META`)이었고, 이어 과목 라벨/색/선택지/엑셀출력을 하드코딩한
    14개 추가 파일을 전부 설정 기반으로 전환. **클라 단일 소스 신설**: `(shell)/layout`이 3경로(embed창·미니셸·풀셸)를
    [`OperationsProvider`](src/features/owner/operations-context.tsx)로 감싸 `useSubjectMaps()`/`useGradeLevels()`
    훅 제공(클라는 부모 prop 배선 불필요·창 안까지 커버). 서버는 `buildSubjectMaps(getTenantSettings)` 직접.
    수정 파일: dashboard `now-cockpit`(+`subject-meta.ts`는 시간헬퍼만 남기고 과목 라벨/색 제거)·`student-summary-view`·
    `student-quick-popover`·`classes/[id]`·`enrollment-assign-dialog`·`convert-dialog`·`withdrawals`·`timetable/page`(SUBJECT_ORDER
    닫힌 enum→설정 도출)·`class-cell`·`level-tests`·`catalog-table`(과목만; 학년 초/중/고는 교재 coarse 버킷이라 유지)·
    `exam-form-dialog`·`staff/[id] basic-info`·`exports/{timetable,students}-excel`·`students/_components/student-filter-bar`(학년필터).
    **규칙은 위 "⚠️⚠️ 운영체계 enum 하드코딩 절대 금지" 섹션 참조.** 새 목록/필터/표시는 반드시 그 단일 소스로 — native 하드코딩 과목/학년 맵 금지.
- **🚫 입력 숨김(소비처 없어 v1 비노출 — 상태·스키마·저장은 보존, 소비처 생기면 입력만 복원)**: operations `terms`,
  billing `taxMode`·`defaultMethod`(invoices에 결제수단 컬럼 없음), notifications `kakaoChannelId`(발송 경로에 미사용·대응 컬럼 없음).
- **✅ 배선 완료(2026-06-23)**: notifications `privacyTerms`·`serviceTerms` → **학부모 QR 공개접수 폼**(`(intake)/intake/[token]`)의
  개인정보/환불·학칙 동의 블록으로 소비(notifications-section에 TextAreaField 입력 복원). + operations `shuttle`
  (enabled/fee/routes 신규) → 공개접수 폼 셔틀 섹션으로 소비(operations-section `ShuttleEditor`). 둘 다 owner 폼 저장 →
  공개 폼 즉시 반영(실검증: fee "월 35,000원" 저장→공개폼 반영). ⚠️ 공개 폼은 인재원 데모 정적 텍스트를 더 이상
  하드코딩하지 않고 전부 학원설정에서 읽음(소비처 0 orphan 해소).

### 설정 면 목록 = 한 곳 · 범주 5개 (2026-10-06)

- **면의 이름 · 주소 · 순서 · 범주 · 전용 표식은 [`OWNER_FACES`](../../src/features/owner/tabs.ts) 한 곳에만 적는다.** 화면 탭(`owner/page.tsx`) · 사이드바 하부탭(`navigation.ts`) · 설정 메뉴 판(`menu-hub.ts`)이 파생한다. 면마다의 그림만 `menu-hub.ts`의 `OWNER_FACE_ICON`이 붙인다(면을 더하면 타입이 그 표를 요구한다). 🔴 메뉴 판에 `/owner` 주소를 손으로 다시 적지 말 것(가드 `tabs.test.ts`).
- **범주 5개**(설정 메뉴 판의 묶음 제목): 학원 정보 / 수업·운영 / 청구·안내 / 권한·화면 / 관리. 목록 순서대로 읽으면 범주가 한 덩어리씩 이어지고, '관리' 범주가 곧 화면 탭의 관리 묶음(구분선 뒤)이다. **면을 합치지는 않았다** — 주소 · 권한 키 · 창 식별은 그대로다.
- **전용 표식 둘**: `genericOnly`(새 학원에만 — '기능') · `masterOnly`(원장 위에게만 입구를 세움 — 기능 · 대시보드 관리 · 감사로그). 입구를 정리하는 표식일 뿐 게이트가 아니다(자물쇠는 본문 · 저장 액션 · DB 정책). 어느 학원에나 서는 면만 담은 `OWNER_TABS`가 사이드바 하부탭 · 도움말 목차 · 주소 해석에 쓰인다.
- **입구 판정은 [`face-access.ts`](../../src/features/owner/face-access.ts)** — 요청한 면의 권한이 없으면 입구가 서는 첫 면으로 보낸다(최종 권한 표 `getUserPermMatrix`로 판정 · 원장 위 전용/일반판 전용 조건 포함 · 제 주소로 되돌리지 않음 · 창 표식 유지). 권한은 있는데 원장 위 전용인 면에 위임 계정이 오면 보내지 않고 그 면이 직접 안내한다. 도착한 면은 제 가드(`requireAccess`)를 다시 지난다.
- **자체 판정을 하는 면**(데이터 정리 · 데이터 가져오기 · 감사로그)은 페이지의 설정 쓰기 잠금(fieldset · '읽기 전용' 안내) 밖에 둔다 — `SELF_GATED_TABS`.
- **보강 운영 = 제 면**(2026-10-06, 수업·운영 범주 · 원장 위 전용). 전에는 운영 체계 면 맨 아래에 제 저장 버튼을 달고 붙어 있었다 — 운영 설정(`operations`)과 다른 묶음(`makeups`)이라 저장 경로가 따로다(`configureMakeupSettings` → DB가 열린 보강 건을 확인하며 운영 모드를 원자적으로 바꾼다). 한 화면에 저장 버튼이 둘이면 어느 버튼이 무엇을 저장하는지 알 수 없다. 🔴 다시 운영 체계 면에 붙이지 말 것. 보강관리를 켜는 스위치가 이 면이므로 기능(모듈) 목록으로 가리지 않는다.
- **줄이 계속 느는 카드는 접는다**(2026-10-06 — 강의실 · 공휴일). `SettingsCard`의 `collapsible`(+ 제목 줄에 몇 개인지 `summary`) — 처음엔 접혀 있고 제목 줄을 누르면 펼친다. 접혀 있어도 안의 입력은 살아 있어 고치다 접어도 값이 남고 저장에 실린다. 펼친 상태는 기억하지 않는다(늘 접힌 채로 연다). 짧은 카드까지 접지 않는다.
- **화면 위쪽 탭 = 범주 줄 + 그 범주의 면 줄**(2026-10-06, [`tab-rows.ts`](../../src/features/owner/tab-rows.ts) · `owner-tab-bar.tsx`). 면 열넷을 한 줄에 세우면 넓은 화면에서도 넘쳐 좌우로 밀어야 했다.
  - **주소는 그대로다** — 면마다 `?tab=`. 범주는 주소에 없고 지금 면에서 읽는다(북마크 · 창 · 사이드바 하부탭 · 권한 키 불변).
  - 범주를 누르면 그 범주에서 **열 수 있는 첫 면**으로, 지금 범주를 다시 누르면 지금 면에 머문다. 열 수 있는 면이 없는 범주는 세우지 않는다.
  - 보이는 면이 **범주 수(5) 이하면 접지 않는다**(한 줄 — 종전 모양). 면 한두 개만 맡은 사람에게 범주 줄은 줄만 늘린다.
  - 면이 하나뿐인 범주도 면 줄을 세운다(지금 어느 면인지 보이고, 범주를 옮겨도 줄 수가 바뀌지 않는다).
  - 범주 칸은 목적지가 아니라 묶음이다 — `FaceTabs`의 `customLabels={false}`로 그 주소의 메뉴 구성 행을 따라가지 않게 한다. 설정의 면은 고정 목적지라 개명되지 않는다(`menu-layout.ts`).
  - 면을 바꿀 때 저장하지 않은 입력은 종전처럼 묻지 않고 사라진다(탭 전환 = 종전과 같은 링크) — 범주 전환도 같다. 바꾸려면 따로 정한다.

### 운영 섹션 저장 계약 (2026-10-06 — 통째 교체 금지)

- **요청 형식은 넷뿐이다** — `saveOwnerSection`의 `section=operations`는 `operationsFace`가 필수다: 두 면(`operations`·`subjects`, 기준 token 필수) · `subject-fields`(시간표 쪽 서버 호출 — 한 과목의 여섯 칸만) · `subject-remove`(과목 흡수·삭제 뒤). 없거나 모르는 값이면 저장하지 않는다. 운영 섹션 전체를 읽어 되돌려 보내는 저장을 새로 만들지 말 것.
- **칸의 주인**은 [`operations-slice.ts`](../../src/features/owner/operations-slice.ts)가 정한다 — 운영 체계 면 8칸 / 과목 운영 면 3칸 / 과목 행 안의 시간표 6칸 / 아무도 맡지 않는 3칸(편집 화면이 없다). 운영 칸을 스키마에 더하면 여기서 주인을 정한다(가드 테스트가 빠진 칸을 잡는다).
- **같은 면의 동시 편집은 통째로 거절한다**(공휴일 ↔ 자리 비밀번호처럼 서로 다른 칸이어도) — 보수적 선택이다. 다른 면·시간표의 변경은 충돌이 아니다.
- **보관함 도장·다듬기는 중앙 저장이 정한다**([`subject-fields.ts`](../../src/features/owner/subject-fields.ts)) — 요청이 보낸 '누가·언제'는 버린다.
- **`tenant_settings`를 쓰는 앱 코드는 전부 `updated_at`을 직전 값과 다른 값으로 갱신한다**(가드 `tenant-settings-writers.test.ts`). 운영 섹션을 다시 쓰는 앱 저장은 섹션 안의 저장 순번(`operations.rev`)도 올린다 — 문서 최상위에는 두지 않는다([[#142]]).
- **편집 폼은 캐시 없이 읽은 값으로 연다**(`getTenantSettingsForEdit`) — 설정 캐시(TTL 300초)는 스크립트·cron·시트 반영 뒤 낡을 수 있고, 낡은 기준 값은 새로고침해도 저장이 계속 거절되는 화면을 만든다. 기준 token은 저장할 수 있는 사람에게만 내려준다(자리 PIN에서 나온 값이다).
- **보호 범위 밖** — 운영자가 손으로 돌리는 `scripts/` 아래 스크립트. 설정 저장·cron·시트 반영과 동시에 돌리지 않고, 읽어 둔 문서를 통째로 되써 옛 순번을 넣지 않는다.
- **남긴 것(후속)** — 데모 구성의 요일 병합 SQL은 과목 면이 맡는 값을 바꾸면서 순번을 올리지 않는다(데모 지점 한정). 같은 면 안의 칸 단위 병합.

### 역할·권한 저장 계약 (2026-10-06 — 기준 값 없이 저장하지 않는다)

- **쓰는 곳이 여럿이다** — 역할·권한 면(세 칸 전체를 되돌려 보낸다) · 화면마다 있는 '역할 설정' 대화상자(역할별 칸의 일부) · 운영자 스크립트(개인별 예외). 그래서 면의 저장은 `permissionsBaseline`이 **필수**다: 화면이 연 시점의 값을 가리키는 token이고, 저장할 때 방금 읽은 값의 token과 다르면 저장하지 않는다. 없으면 "화면이 오래되었습니다"로 거절한다.
- **기준은 저장되는 칸 전부**(역할별 · 개인별 메뉴 권한 · 개인별 기능 권한의 네 칸)다 — [`permissions-canonical.ts`](../../src/features/owner/permissions-canonical.ts). 칸을 더하면 여기에도 넣을 것 — 빠진 칸의 다른 저장은 조용히 되돌아간다.
- 🔴 **저장된 줄을 그대로 견준다(줄의 차례만 무시) — "적용하면 같은 표"로 접어 견주지 말 것.** 같은 저장값을 앱과 DB가 다르게 읽는다: 같은 칸(메뉴·직급)의 줄이 둘이면 앱(`resolveMatrix`)은 마지막 줄을, DB의 권한 함수(`auth_menu_access`, 0170a)는 먼저 걸리는 한 줄을 쓴다. 기본값과 같은 줄도 DB에는 뜻이 있다(DB의 기본값 표에 없는 메뉴는 줄이 없으면 '없음'). 표로 접으면 그런 저장이 "안 바뀜"으로 보여 옛 화면의 저장이 그 줄을 지운다(적대 리뷰 2 C1 — 처음엔 표로 견줬다). 대가는 보수적 거절이다: 대화상자가 뜻을 바꾸지 않고 다시 써도 모양이 달라지면 수정 중이던 면의 저장은 거절된다.
- **같은 칸을 두 번 지정한 저장 요청은 거절한다**(저장 액션 — 스키마가 아니다. 스키마는 이미 저장된 값을 읽는 데도 쓰여서, 거기서 막으면 그런 값이 저장된 학원은 역할·권한을 고칠 수 없게 된다). 이미 그렇게 저장된 값은 면이 **어느 칸인지 알리고**, 저장하면 표의 값(마지막 줄) 하나로 정리된다 — 말없이 정리하지도, 편집을 막지도 않는다(막으면 손으로 DB를 고치기 전까지 권한을 못 바꾼다).
- **화면과 저장이 같은 함수**(`permissionsToken`)로 만들고, 저장 응답은 **실제로 저장된 값**을 다시 풀어 읽은 token을 돌려준다(요청에 없던 칸은 저장돼 있던 값으로 남는다 — 보낸 값으로 만들면 다음 저장이 막힌다).
- **역할·권한 면에는 머리글 '역할 설정' 버튼이 없다** — 그 면의 표가 같은 칸을 고친다. 한 화면에 같은 값을 고치는 곳을 둘 두지 않는다.
- **섹션 안의 저장 순번(`permissions.rev`)** 을 면의 저장과 대화상자의 저장이 올린다(운영 섹션과 같은 쓰임 — 편집 폼이 "내 저장보다 먼저 읽힌 값"을 가려낸다, [[#142]]). 문서 최상위에는 두지 않는다.
- 그대로인 것 — 원장 전용(저장 액션 · DB 트리거) · 옛 화면이 안 보낸 칸의 보존(`preset.ts` — 저장값 위에 요청이 보낸 칸만 얹는다 · 이 코드가 모르는 저장 칸도 남긴다) · 운영자 계정 보호(`platform-settings.ts`). token은 충돌을 알아채는 값일 뿐 권한 근거가 아니다.

### 역할·권한 면의 줄 구성 (2026-10-06 — 왼쪽 탭과 그 내부 메뉴의 차례)

- 원장: *"권한도 실제 좌측 탭과 탭 클릭시 나오는 내부메뉴에 맞게 권한 정렬해줄것. 이건 탭 및 메뉴구성과 배선을 일치화 시켜서 구조를 철저히 맞출것."*
- **줄 구성의 단일 소스 = [`permission-rows.ts`](../../src/features/owner/permission-rows.ts)** — 표와 개인별 권한의 메뉴 고르기가 같은 목록을 쓰고, '강사 내 메뉴 표시' 칸은 짝 모듈 [`teacher-toggle-rows.ts`](../../src/features/owner/teacher-toggle-rows.ts)가 강사 '내 메뉴'의 차례로 정한다. 차례·묶음·이름은 사이드바와 같은 해석(`configuredHubGroups` — 학원의 `navigation.menus`·`groups`·`teacherMenus`·`teacherGroups`)에서 나온다. 🔴 여기에 메뉴 차례를 다시 적지 말 것.
- 줄의 단위는 **권한 키**다(목적지가 아니다). 그 권한의 대표 화면(메뉴 자신의 주소 — 없으면 그 권한을 쓰는 첫 목적지)이 있는 자리에 서고, 함께 여는 면은 줄 아래에 이름으로 적는다(원장만 들어가는 면은 적지 않는다). 메뉴 버튼이 없는 권한은 그 권한을 쓰는 화면 아래(주소가 있는 설정 권한은 주소에서 저절로 · 주소가 없는 셋 = 랩실·JJ실 출석부 · 구글 시트 연동 · makeedu 연동만 손으로 적는다).
- 🔴 **모든 권한 키가 정확히 한 번** 선다 — 메뉴 구성에서 감춘 줄도 남는다(감춤은 입구뿐). 단 **화면(표 · 개인별 메뉴 권한의 메뉴 고르기)에는 탭 및 메뉴 구성에 있는 화면의 권한만 세운다**(`editablePermissionRowGroups` — 원장 2026-10-06 *"탭 및 메뉴 구성에 사용중인 역할만 역할 권한에 넣을것"*): '메뉴에 없는 화면' 묶음(캘린더 · 관리자 도구)과 역할 전용 화면 둘(선생님 원스크린 · 내 학습 — 어느 역할의 칸도 바꿀 수 없다, *"역할 필요없어 보이는데"*)을 뺀다. 권한 자체와 저장값은 그대로다(표가 적용되는 값 전체를 들고 저장한다). 🔴 구성에서 **감춘** 메뉴의 줄도 세우지 않는다(원장 2026-10-06 *"감춘 메뉴 줄도 표에서 빼"* — 그 화면 안에서 쓰는 권한 줄도 함께. 관리자뷰에서 감췄어도 강사 '내 메뉴'에 보이면 쓰는 것이라 '관리자뷰에서 감춤' 표식과 함께 남긴다 · 강사뷰 '설정' 묶음의 설정 권한은 관리자뷰만 따른다(화면 안에서 쓰는 설정 — 급여 비율 설정 등 — 은 그 화면 줄을 따른다) · '저장 전 변경' 목록은 표에 없는 줄의 변경도 적는다). ⚠️ 감춘 메뉴는 입구만 없을 뿐 주소로는 열린다 — 그 권한을 고치려면 구성에서 다시 보이게 한 뒤 표에서 고친다. 새 권한 키가 어디에도 속하지 않으면 '메뉴에 없는 화면'으로 떨어지고 가드(`permission-rows.test.ts`)가 그 목록을 잠근다 — **새 권한 키를 만들면 메뉴에 세우거나 속할 화면을 정할 것**.
- 개인별 메뉴 권한은 어느 학원에서나 이 면에서 주고 거둔다.
- **개인별 기능 권한**(`permissions.specialAccess` — 사람을 지정해서 여는 기능)도 어느 학원에서나 이 면에서 주고 거둔다(원장 2026-10-06 *"개인 역할은 전부다 편집기"* — 전에는 새 학원에만 섰고 침산은 코드 명단이었다). 칸 → 소비처:
  - `payslipViewerIds` → `canViewPayslipNow`(급여명세서 화면·조회·저장·발행 — 지정한 사람은 출석부 메뉴 권한도 있어야 프리랜서 명세서가 열린다) · `leaveAdjusterIds` → `canAdjustLeave`(직원관리 연차 관리 화면·버튼·서버 액션 — 화면도 액션도 직원관리 메뉴 권한을 함께 본다)
  - `classSplitterIds` → `canSplitClassNow`(시간표 수업 나누기 — 원장 역할은 지정 없이 통과 · 수업 관리 권한(전체)도 함께 본다) · `staffSubjectScopes` → `getViewerStaffScope`·`canSeeStaffMember`(직원관리 목록·상세·근무 설정·이력서·계정·계약·엑셀·연차 관리)
  - 급여 기능이 꺼진 학원에는 급여명세서 칸을 세우지 않는다(저장값은 그대로 실려 간다). 🔴 수업 나누기를 꺼 둔 동안(`CLASS_SPLIT_ENABLED` = false, 2026-10-06 현재)에는 수업 나누기 칸도 세우지 않고 누구도 못 나눈다 — 저장값은 유지.
  - 저장은 **어느 학원에서나 새로 지정하거나 바꾼 것만** 확인한다(재직 직원 · 학원 설정의 과목) — 전부를 다시 보면 과목 흡수·퇴직 뒤 역할 표 저장까지 막힌다.
  - 🔴 **원장 역할은 네 칸 모두 지정 없이 통과한다**(과목 범위도 안 걸린다 — 원장 2026-10-06 *"원장이니 최상위 권한"*). 지정은 원장이 아닌 사람에게만 뜻이 있어 화면의 직원 고르기에 원장 역할을 세우지 않는다.
  - 🔴 칸을 더할 때 함께 고칠 곳은 스키마 주석에 적혀 있다(`settings-types.ts` — 기본값 둘 · 기준 token · 운영 계정 보호 · 옛 화면 저장 보존 · 변경 내역 라벨). 하나라도 빠지면 그 칸의 저장이 조용히 되돌아가거나 지워진다.

### DB가 필요한데 없는 것 (jsonb로 못 담는 것 포함)
`tenant_settings.data`는 텍스트/숫자/배열만 담는다 — **이미지·파일은 Supabase Storage 버킷이 별도 필요**.

2026-10-06 코드 대조로 고친 상태(이 목록은 오래 낡아 있었다 — 아래 셋은 이미 구현돼 있다):
- ~~로고 **이미지**·직인 이미지~~ → **✅ 구현됨**: `profile.logoUrl`·`sealUrl`(Storage `branding` 버킷, 업로드 티켓 `issueBrandingUploadTicket`). 소비처 = **로고**: 등록 상담지 · 수업 보고서 · 교재 요청서 인쇄(`(print)/enrollment|lesson_reports|textbook/…/print`) / **직인**: 등록 상담지 인쇄. 로그인 화면은 학원 이미지를 쓰지 않는다(제품 표식 고정 — 비로그인 브랜드 헬퍼는 글자만 읽는다).
- ~~사업자등록번호~~ → **✅ 구현됨**: `profile.bizRegNo`. 소비처 = 등록 상담지 인쇄 하단 · 급여명세서(`payslip-queries.ts`).
- ~~**역할/권한 편집**~~ → **✅ 구현됨**: `…data.permissions`(역할별 `overrides` · 개인별 `userOverrides` · 개인별 기능 권한 `specialAccess`) + 학원 설정 > 역할·권한 · 화면마다의 '역할 설정' 대화상자. DB 쪽 판정은 `auth_menu_access`(0170a)와 쓰기 가드(0335a). 저장 규칙은 위 '역할·권한 저장 계약'.
- ~~**과목별 교시 세트**~~ → **✅ 완료(2026-07-06)**: `subjects[].weekdayPeriods`(jsonb, 마이그 0) + 과목 운영 탭 편집기
  + `weekdayTableFor` 폴백 체인(과목 전용→english 내장→전역). 시간표 기본뷰·통합뷰·강사뷰·학생 상세 라벨 전부 소비.
- 운영시간(영업시간, 교시와 별개) → **미확인**(스키마에 칸이 없다 — 필요해지면 jsonb 필드 추가만으로 가능).

### 소비처에 맞춘 칸 (2026-10-06)
- **notifications `printHeader`(인쇄물 머리글)** 의 소비처는 등록 상담지 · 상담 준비 서류 인쇄 둘이다(`(print)/enrollment/[id]/print|prep`). 화면 안내도 그렇게 적는다(전에는 "청구서·성적표 상단"이라고 적혀 있었다 — 그 두 인쇄물은 이 값을 읽지 않는다).
- **`subjects[].monthPlan`(월간 계획서 인쇄 문구)** 은 영어 과목의 값만 읽힌다(`MONTH_PLAN_SUBJECT_KEY` — 인쇄물과 계획(MP) 화면). 편집 칸도 그 과목에만, 영어 강사 시트 기능이 켜져 있을 때만 선다. 다른 과목에 이미 저장된 값은 지우지 않는다.
- **데이터 가져오기** 는 이 학원에서 끈 기능의 줄을 세우지 않는다(켜져 있고 권한만 없는 줄은 선다).
- **consultations `briefFacts`(상담 준비 브리프 — 학원 운영 안내 · 2026-11-12)** = 상담 양식 면의 주제별 글 6칸(보고·학부모 상담 주기 · 과제·오답 관리 · 보강 · 레벨테스트·반 배정·첫 수업 · 체험 수업 · 할인, 각 200자 · 기본 빈칸 · 전 과목 공통). 주제 목록은 [`brief-facts.ts`](../../src/features/enrollment/brief-facts.ts) 한 곳. 소비처 = `collectPrepFacts` → 브리프 사실 스냅샷 `policy.operations` → 브리프 화면 '학원 운영 안내' · `/prep` 인쇄 · 프롬프트(원문을 바꿔 약속하지 말 것). 🔴 같은 섹션의 양식 편집기와 한 state로 저장한다(섹션 통째 저장 — 따로 두면 서로를 지운다) · 요청에 `briefFacts`가 없으면(배포 전에 연 옛 폼) 저장값 유지(`prepareSectionForSave`). 저장 권한은 `consultation_settings` 그대로. AI 라이선스(ai_analysis)가 꺼진 지점엔 카드를 세우지 않는다(값은 보존). ⚠️ 두 창에서 같은 면을 고치면 나중 저장이 이긴다(다른 섹션과 같다).

---

