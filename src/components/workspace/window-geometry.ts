/**
 * 윈도우 기하 — 순수 함수(테스트 강제). DOM·React 무관.
 * 좌표계: 캔버스 로컬(0,0 = 캔버스 좌상단). bounds = 캔버스 크기.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type Bounds = { width: number; height: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
// 절반(left/right/top/bottom)·최대화(max)·1/4 모서리(tl/tr/bl/br)
export type SnapZone =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "max"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | null;

export const MIN_W = 360;
export const MIN_H = 280;

/** 캔버스 안으로 + 최소 크기 보장하여 보정. */
export function clampRect(rect: Rect, bounds: Bounds): Rect {
  const w = Math.min(Math.max(rect.w, MIN_W), Math.max(MIN_W, bounds.width));
  const h = Math.min(Math.max(rect.h, MIN_H), Math.max(MIN_H, bounds.height));
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, bounds.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, bounds.height - h));
  return { x, y, w, h };
}

/** 기본 창 크기(폼·목록 등 일반 메뉴). */
export const DEFAULT_WINDOW = { w: 480, h: 560 };

/**
 * 라우트(메뉴)별 기본 창 크기 — 넓은 표는 크게 열어 가로 스크롤을 최소화한다.
 * 없는 메뉴는 DEFAULT_WINDOW. 캔버스보다 크면 cascadeNext에서 clamp됨.
 */
export const ROUTE_WINDOW_SIZE: Record<string, { w: number; h: number }> = {
  // 운영실 — 지표 줄·오늘 브리핑·접힌 2차 줄이 들어가는 폭(2026-09-07 창으로 전환).
  dashboard: { w: 1180, h: 820 },
  timetable: { w: 1040, h: 680 }, // 강사×요일 표라 폭이 넓음
  // 시간표 편집기(연습본) — 강사 여러 명의 요일 칸 + 오른쪽 확인 패널(320px)이 함께 서는 폭. 시간표 창(1040)을
  // 상속하면 패널을 열 때 격자가 서너 칸만 남는다. 자기 창으로 열린다(`EditorShortcut`의 frameTarget="window").
  "timetable/editor": { w: 1280, h: 760 },
  classes: { w: 1100, h: 700 }, // 고정 8열 표(16/18px 글자, 열 머리 필터)가 가로 스크롤 없이 서는 폭 — v5 최소 창(2026-09-04 주석 갱신; 필터바는 없어졌다)
  // 수납 표 15열(min-w 1080)이 가로 스크롤 없이 서는 폭 — v5 "창마다 최소 크기"(2026-09-04, 옛 760×620). 교재·지출·계산기 면도 상속.
  billing: { w: 1160, h: 720 },
  // 학생×30~31일 매트릭스. 폭이 좁으면 이름 칼럼이 글자당 줄바꿈돼 행이 2배로 커지고(세로 스크롤
  // 유발), 1280이면 30·31일 달 모두 이름이 한 줄로 펴져 콘텐츠가 ~488px로 줄어든다(세로 스크롤 제거).
  attendance: { w: 1280, h: 620 },
  // 출결 모드(2026-08-20) — 카드가 세로로 쌓이는 **한 열** 화면이라 폭보다 높이가 필요하다.
  // 부모(attendance 1280×620)를 그대로 상속하면 칩 격자가 가로로 늘어지고 세로는 서너 반에서 잘린다.
  "attendance/quick": { w: 560, h: 820 },
  // 🔴 자리(랩실·JJ실) 출석부는 **여기 등록하지 않는다** — 위 `attendance`(1280×620)를 그대로
  //    상속해 월별 출석부와 **같은 크기**로 연다(원장 2026-09-03: *"월별 출석부와 같은 화면
  //    크기로. 접근 방법만 다르지 기능이 다르지 않기 때문에"*). 전용 크기를 넣으면 같은 일을
  //    하는 두 화면이 창마다 다른 크기로 떠서 오히려 갈린다.
  //    ⚠️ 한 교시에 반이 3개면 진도 붙은 JJ 열(440px×3)이 1280을 넘어 가로 스크롤이 남는다 —
  //       그건 드래그로 밀어서 쓰고, 창을 키우면 그 창 크기는 기억된다.
  exams: { w: 960, h: 680 }, // 시험 목록(통계 열) + 반 일괄 점수 그리드
  // ECS(English Class Sheet) — 요일 컬럼(432px, 2026-08-17 열 다이어트) 3개가 패널 접힘 기준 가로
  // 스크롤 없이 들어가는 폭(가용 1330 ≥ 3×432+틈24=1320). 패널(300px) 열면 ~2.3개. 상세는 prefix 상속.
  ecs: { w: 1400, h: 760 },
  // MCS(Math Class Sheet) — 학생 × 수업일 진도표. 왼쪽 고정열(210) + 수업일 열(최소 168)이라
  // 주 2일 반(월 8~9열)은 어차피 가로 스크롤이지만, 주 1일 반(월 4~5열)은 이 폭이면 통째로 들어간다.
  // 기본 480이면 열이 하나도 안 보이고 목표 칸만 남는다.
  mcs: { w: 1240, h: 760 },
  // 🔴 수학 학습 진도맵(`/mcs/progress-map`, 시안 2026-09-14)은 **여기 등록하지 않는다** — 입구가 MCS 창 안의 `EmbedLink`라 같은 창
  //    (1240×760)에서 열리므로 따로 적은 크기는 여는 크기가 아니라 **리사이즈 바닥**만 올린다(760 창에서 핸들을 잡는 순간
  //    높이가 880으로 튄다 — 적대 리뷰 2026-09-14). 지도는 `100dvh` 기준으로 창 높이에 맞춘다(`progress-map.tsx`).
  before_class_checklist: { w: 1280, h: 760 }, // 비포클래스체크리스트(초안) — 학생 × 미흡 10항목 + 결석·카드(넓은 표)
  lesson_reports: { w: 980, h: 720 }, // 수업보고서 발송 관리 — 발송 큐 + 강사별 작성률 + 목록(다열 표·필터)
  consultations: { w: 760, h: 640 }, // 상담 목록(카드)·상세(내용+AI 7섹션) — 읽기 콘텐츠라 기본 480은 좁음. 상세 id도 prefix 상속
  // 회의록 — 목록 행(제목 | 상태·녹음·참석·작성자·일시 고정 열 24rem)이 한 줄에 서고 상세(AI 8섹션·전사)가 읽히는 폭.
  // 학생상담과 같은 값(디자인 v5 13단계 2026-09-04 — 기본 480이면 제목 칸이 남지 않았다). 상세 id도 prefix 상속.
  meetings: { w: 760, h: 640 },
  // 퇴원관리 — 월별 추이·과목별 분포(2열)와 명단·사유 분석(2열)이 `lg`(1024px)부터 나란히 선다. 그 아래로 열면
  // 툴바(드롭다운 5 + 검색)가 세 줄로 감기고 차트가 한 열로 쌓인다. 상세(withdrawals/<id>)도 prefix 상속.
  withdrawals: { w: 1040, h: 720 },
  // 신규생 관리 — 학생 한 줄 × 체크 7칸(+등록일·첫 수업·진행) = 12열 표(min-w 56rem). 기본 480이면
  // 표가 통째로 접혀 체크 칸이 하나도 안 보인다(실측 2026-09-09: 358px로 열려 "창을 키워 주세요"만 떴다).
  // 폭은 12열 + 사이드 여백, 높이는 대상 30명이 스크롤 몇 번에 훑히는 값.
  newcomers: { w: 1100, h: 760 },
  // 학생목록 — 5열 표(학생·상태·수강 과목·담당 강사·연락처)가 16px 글자로 한 줄에 서는 폭(디자인 v5 2026-09-03:
  // 이 크기가 곧 **최소 크기**다 — 기본 480이면 표가 통째로 접혔다). 열 머리가 필터라 표는 가로 스크롤 없이 이 폭에 맞춘다.
  // 학생 상세(students/<id>)도 prefix로 이 크기를 상속한다(탭 6개 화면이라 480보다 낫다).
  students: { w: 960, h: 680 },
  // 연결 탐색(원생·수업·강사 중심 도넛 + 오른쪽 패널) — 도넛(≈600) + 패널(≈400)이 나란히 서는 폭(시안 배치, 2026-11-03).
  explore: { w: 1280, h: 820 },
  // 통계는 긴 기간·기준 경계를 함께 읽는 화면 — 작은 창으로 접지 않고 StatsWidthGate에서 본문을 막는다(원장 2026-10-21).
  "students/stats": { w: 1100, h: 760 },
  // 등록상담 칸반 — **4열 고정**(원장 2026-09-03 "창이 줄어들어도 4열 유지 · 탭 접힘 금지"). 칸 4개 × 250 + 틈이 들어가는 폭.
  // 기본 480이면 칸이 120px이라 이름도 못 적는다. 상세(enrollment/<id>)도 prefix로 이 크기를 상속한다.
  enrollment: { w: 1120, h: 720 },

  // 직원 목록 — 직원명부 시트와 같은 15열(소속·이름·직급·계약구분·메일·입사일·전화·현재계약·조건·갱신일…).
  // 기본 480은 두 열도 안 들어간다. 넓게 열고 부족한 폭은 가로 스크롤로.
  // 세로는 원장이 실제로 늘려 쓰던 크기(2026-07-31 "이정도로 키워줘") — 한 화면에 10행이 들어간다.
  staff: { w: 1320, h: 900 },
  "staff/payroll": { w: 920, h: 640 }, // 월별 전직원 급여표(8열) — 폭 넓음
  "staff/resumes": { w: 840, h: 720 }, // 직원 이력서(작성 폼·A4형 시트 뷰) — 상세 id도 prefix로 상속
  // 내 정보 — 계정 카드(2열) + 이력서 시트 통째. 기본 480×560이면 시트가 접혀 읽을 수 없다(원장 지적 2026-07-31).
  // staff/resumes(840)보다 계정 카드만큼 더 필요해 세로를 키움.
  me: { w: 900, h: 800 },
  class_review: { w: 1180, h: 860 }, // 30문항 매트릭스 + 평가자 열 — 폭·높이 넉넉히
  // 휴가관리 — 연차 현황(3칸 스탯) + 신청 폼 + 내역 표 / 전자결재함. 기본 480은 폼 2열이 접힌다.
  approvals: { w: 1000, h: 800 },
  calendar: { w: 1120, h: 800 }, // 월 그리드(7열×5~6주) — 칸당 일정 칩이 설 폭
  // 셔틀 — 편성 보드가 **3열**(회차/노선/학생)이고 그 그리드는 `lg`(1024px)부터 펴진다. 등록이 없어
  // 기본 480px로 열리면 데스크톱 창인데도 폰용 3탭 레이아웃이 떠서 드래그 편성을 할 수 없었다.
  // (`shuttle/today`는 longest-prefix로 이 크기를 상속 — 회차 카드가 한 열로 시원하게 선다.)
  shuttle: { w: 1180, h: 760 },
  // 재고관리 — 자산 표가 11열(자산ID·분류·제조사·모델명·입고일·상태·현위치·사용자·최종실사·폐기일·비고) +
  // 툴바(검색·필터 칩 11개). 기본 480이면 표가 통째로 접힌다.
  inventory: { w: 1180, h: 760 },
  // 교재목록 — 표지 썸네일 + 차수 표(진도·과제 2열)를 함께 보려면 폭이 넉넉해야 한다.
  textbooks: { w: 1140, h: 780 },


  "billing/refunds": { w: 840, h: 720 }, // 환불 요청서(작성 폼·A4형 시트 뷰) — 상세 id도 prefix로 상속
  owner: { w: 960, h: 720 }, // 학원 설정 콘솔 — 탭 + 목록 편집(과목·교시·직급) 폼
  documents: { w: 980, h: 640 }, // 데이터베이스(서식 저장소) — 탐색기형(좌 폴더 팬 + 우 상세 테이블)
  // 도움말 허브(FAQ + 질문 게시판). 상세 `/help/posts/<id>` · `/help/icons` 도 prefix 상속.
  help: { w: 960, h: 760 },
  // 고객센터 — 개선요청 표(No·제목·등록자·등록일시·처리상태·예정일)가 한 줄에 서는 폭. 상세·글쓰기도 prefix 상속.
  support: { w: 1000, h: 760 },
  // ⚠️ 메뉴 루트 창 id는 경로가 아니라 menuKey(언더스코어) — windowIdForHref가 menuKey를 반환한다.
  textbook_requests: { w: 1180, h: 760 }, // 교재 요청 — ijw 구조(좌 폼 + 우 실시간 요청서 미리보기 720px)
  // 지출결의서(강사) — 내 결의서 목록 + 등록 모달. 🔴 메뉴 루트 창 id는 menuKey(`expense_requests`, 언더스코어)라
  // 하이픈 키만 두면 목록 창이 480×560으로 열렸다(2026-09-23 전수 점검 F20). 하이픈 키는 상세(`expense-requests/<id>`,
  // 경로 기반 id)의 prefix 상속용으로 남긴다(A4 문서는 max-w-760 중앙정렬이라 무해).
  expense_requests: { w: 900, h: 720 },
  "expense-requests": { w: 900, h: 720 },
  // 이탈 방어 — 위험 목록과 사유 패널이 `lg`(1024px)부터 2열로 선다. 기본 480이면 한 열로 접혀 '창마다 최소 크기'
  // 규칙(2026-09-03)을 어겼다(F20). 보드(retention/board)·캠페인도 prefix로 상속한다.
  retention: { w: 1100, h: 760 },
  // "새 X" 생성 폼 창(옛 우측 슬라이드 패널 폭 계승). 기본 480×560은 다열 폼엔 좁다.
  "classes/new": { w: 760, h: 680 },
  "staff/new": { w: 620, h: 680 },
  "students/new": { w: 760, h: 680 },
  "enrollment/new": { w: 820, h: 700 },
  "consultations/new": { w: 960, h: 720 }, // 2단 폼(좌 메타 + 우 큰 요약) — 넓은 창에서 요약이 시원하게 커짐(md 2단 트리거)
  "meetings/new": { w: 600, h: 640 },
  "billing/expenses": { w: 720, h: 860 }, // 지출결의서 A4 문서(세로형) — 폭보다 높이가 필요
  // 인쇄 문서 창(세로 A4). 창 id 규약 `print/<type>/<recordId>` → longest-prefix가 `print/<type>` 매칭.
  // (windowIdForHref가 만드는 `enrollment/123/print`는 매칭 못 해 DEFAULT로 떨어지므로 명시 id 사용.)
  "print/enrollment": { w: 840, h: 1120 }, // 신입생 인수인계서
  "print/enrollment-prep": { w: 840, h: 1120 }, // 상담 준비 브리프(상담 전 내부용)
  "print/meetings": { w: 840, h: 1120 }, // 회의록
  "print/textbook": { w: 800, h: 1040 }, // 교재요청서 카드(짧음)
  "print/lesson_reports": { w: 840, h: 1120 }, // 수업 보고서(원스크린 PDF)
  // 급여명세서 + **그 달 출석부 별지**(가로 A4). 별지 콘텐츠가 277mm(=1047px)라 창이 그보다 좁으면
  // 볼 때마다 가로로 밀어야 한다 — 별지가 통째로 들어가는 폭으로 연다.
  "print/payslip": { w: 1120, h: 1120 },
  // 자리 월간 별지(가로 A4, 출석부 서식 재사용).
  "print/seat-month": { w: 1120, h: 840 },
  // EiE 월간 계획서(가로 A4) — 요일 3개 × 최대 4열이라 세로로는 칸이 잘린다.
  "print/ecs-mp": { w: 1120, h: 840 },
  // 자산 QR 라벨 시트(세로 A4, 4열 × 7행) — 기기에 붙일 라벨.
  "print/inventory-qr": { w: 840, h: 1120 },
};

/**
 * 크기 표 매칭 — 정확 매칭 후 **세그먼트 경로 longest-prefix**로 폴백하고, 매칭된 키의 **깊이**(세그먼트 수)를 함께 준다.
 * 깊이는 창 id와 창이 보는 주소 중 어느 쪽이 더 구체적으로 등록됐는지 가르는 데 쓴다(`windowMinSize`).
 * ⚠️ 표에 직접 있는 키만 본다 — 주소에서 온 키가 `constructor` 같은 프로토타입 이름이면 함수를 크기로 읽는다.
 */
function routeSizeMatch(key: string): { size: { w: number; h: number }; depth: number } | undefined {
  const seg = key.split("/");
  for (let i = seg.length; i >= 1; i--) {
    const k = seg.slice(0, i).join("/");
    if (Object.prototype.hasOwnProperty.call(ROUTE_WINDOW_SIZE, k)) return { size: ROUTE_WINDOW_SIZE[k], depth: i };
  }
  return undefined;
}

/**
 * 라우트 창 id → 기본 크기. 정확 매칭 후 **세그먼트 경로 longest-prefix**로 폴백 →
 * 상세 라우트(예: "billing/expenses/<uuid>", "exams/123")가 부모 등록 크기를 상속한다.
 * 등록된 다중 세그먼트 키(staff/payroll·…/new)는 마지막 세그먼트가 정적이라 상세 id가 오인 매칭하지 않음.
 * 없으면 undefined(→ 호출부가 DEFAULT_WINDOW).
 */
export function routeWindowSize(id: string): { w: number; h: number } | undefined {
  return routeSizeMatch(id)?.size;
}

/** 주소 → 크기 표의 키 모양(`/attendance/quick?embed=1#x` → `attendance/quick`). */
function pathKey(href: string): string {
  return (href.split(/[?#]/, 1)[0] ?? "").replace(/^\/+|\/+$/g, "");
}

/** 크기 표 키의 메뉴(첫 세그먼트) — `attendance/quick` → `attendance`. */
function menuOf(key: string): string {
  return key.split("/")[0] ?? key;
}

/**
 * 창 **최소 크기** = 그 화면의 기본 크기(`ROUTE_WINDOW_SIZE`, 없으면 `DEFAULT_WINDOW`).
 * 원장 2026-09-03: *"창이 줄어들어도 기존 4열 스타일을 유지하는 게 오히려 가독성이 뛰어남 · 창 크기를 최소 크기보다
 * 줄이려고 할 때 경고를 띄우고 줄어들지 않도록"* — 화면은 이 크기에서 설계됐고(탭 접힘 금지) 그 아래로는 리사이즈가
 * 멈춘다(`resizeRect`의 `min`). 스냅·타일·작은 모니터로 그래도 작아지면 창 안 `WindowMinSizeNotice`가 선다.
 * ⚠️ 캔버스가 그보다 작으면 캔버스가 상한이다 — 소비처가 `min(…, bounds)`로 접는다(창이 화면 밖으로 나가는 것보다 낫다).
 *
 * 🔴 **같은 메뉴 안에서는 창이 지금 보는 화면**(`href`)으로 잰다. 경로형 면(오늘 출결·출결 모드·셔틀 면)은 부모 메뉴
 *    창 하나를 쓰므로(전수검사 2026-09-11) id로만 재면 출석부 창(1280) 안에서 뜬 출결 모드(560)가 1280 기준이 되어,
 *    리사이즈가 1280에서 멈추고 좁힌 창엔 "가로 N px 모자랍니다"가 떴다. 주소를 모르거나 등록이 없으면 종전대로 id.
 * ⚠️ **주소의 메뉴(첫 세그먼트)가 창 id의 메뉴와 다르면 id** — 다른 메뉴로 드릴인한 화면(원생 창 안의 콜&상담 상세)이
 *    창 바닥을 그 메뉴 크기로 바꾸지 않는다(종전 동작 유지). 인쇄 창(`print/<type>/…` ↔ `/enrollment/<id>/print`)도
 *    메뉴가 달라 A4 크기 그대로다. 같은 메뉴라도 id가 더 구체적으로 등록돼 있으면 id가 이긴다(매칭 깊이 비교).
 * ⚠️ 창 안 안내(`WindowMinSizeNotice`)는 id를 같은 주소에서 뽑으므로 늘 "같은 메뉴"다 — 다른 메뉴로 드릴인한 화면은
 *    그 화면 크기로 안내한다(이 수리 전과 같다).
 * ⚠️ **여는 크기는 이 함수가 아니다** — 여는 크기는 창 id(`routeWindowSize(params.id)`) 그대로다.
 */
/**
 * **최소 크기만** 따로 낮추는 화면(여는 크기는 `ROUTE_WINDOW_SIZE` 그대로) — 폰에서 쓰도록 반응형으로 만든 면.
 * 사용자 2026-10-16 *"반응형이 1180까지만 막혀있네 — 원래 폰 화면에서 보던 비율까지는"*: 셔틀은 1180으로 열리지만
 * 오늘 등하원·학부모 등하원·운행 현황·실시간 위치·학부모 관리 현황은 폰 레이아웃이 있어 폰 폭(390)까지 줄여도 깨지지 않는다.
 * 🔑 편성 보드(`/shuttle`)는 넣지 않는다 — 3열 드래그 편성이 `lg`부터라 그 아래로는 종전 1180 바닥이 맞다.
 * ⚠️ 키는 세그먼트 longest-prefix로 찾는다(상세 주소도 상속). 창 id가 아니라 **창이 보는 주소**로만 본다.
 */
const ROUTE_WINDOW_MIN: Record<string, { w: number; h: number }> = {
  "shuttle/today": { w: 390, h: 560 },
  "shuttle/parent-rides": { w: 390, h: 560 },
  "shuttle/live": { w: 390, h: 560 },
  "shuttle/track": { w: 390, h: 560 },
  "shuttle/nearby": { w: 390, h: 560 },
  "shuttle/parents": { w: 390, h: 560 },
};

function routeMinOverride(path: string): { w: number; h: number } | undefined {
  const seg = path.split("/");
  for (let i = seg.length; i >= 2; i--) {
    const k = seg.slice(0, i).join("/");
    if (Object.prototype.hasOwnProperty.call(ROUTE_WINDOW_MIN, k)) return ROUTE_WINDOW_MIN[k];
  }
  return undefined;
}

export function windowMinSize(id: string, href?: string | null): { w: number; h: number } {
  // 스토어 모양의 창 id(`route:attendance#1`)가 와도 크기 표 키 모양으로 — 접두와 복제 번호를 뗀다.
  const key = id.replace(/^(route|student):/, "").split("#")[0] ?? id;
  const byId = routeSizeMatch(key);
  const path = href ? pathKey(href) : "";
  // 반응형 면은 최소 크기만 따로(여는 크기와 무관) — 같은 메뉴 안에서만.
  const minOverride = path && menuOf(path) === menuOf(key) ? routeMinOverride(path) : undefined;
  if (minOverride) return minOverride;
  const byPath = path && menuOf(path) === menuOf(key) ? routeSizeMatch(path) : undefined;
  if (byPath && byPath.depth >= (byId?.depth ?? 0)) return byPath.size;
  return byId?.size ?? DEFAULT_WINDOW;
}

/**
 * 라우트 창의 **리사이즈 바닥** — 창이 지금 보는 화면(뒤로 기록 맨 위, 없으면 첫 화면) 기준 `windowMinSize`.
 * 포인터 리사이즈(use-pointer-resize)와 `store.resizeBy`가 **이 함수 하나**를 쓴다 — 갈리면 같은 창이 경로마다 다른
 * 크기에서 멈춘다. 라우트 창이 아니면 undefined(전역 MIN_W/MIN_H).
 * ⚠️ `stack`은 창 id(`win.id`, 복제본 `#n` 포함)로 찾은 뒤로 기록이다 — `params.id`가 아니다.
 */
export function routeMinSize(
  win: { kind: string; params: { id: string; href?: string } },
  stack: readonly string[] | undefined,
): { w: number; h: number } | undefined {
  if (win.kind !== "route") return undefined;
  return windowMinSize(win.params.id, stack?.[stack.length - 1] ?? win.params.href);
}

/**
 * 창 크롬이 먹는 크기 — 창 rect(타이틀바 포함)와 본문 iframe(창 안 `window.inner*`)의 차.
 * FloatingWindow: 타이틀바 `h-9`(36) + 그 아래 선 1 + 바깥 테두리 상하 2 → 세로 39 / 좌우 테두리 2.
 * ⚠️ 타이틀바 높이를 바꾸면 여기도 함께 — 안 맞으면 정확히 최소 크기로 연 창에 "최소 크기 위반" 안내가 뜬다.
 */
export const WINDOW_CHROME = { w: 2, h: 39 } as const;

/**
 * 커서(스테이지 로컬 sx,sy) 위치에서 새 창이 뜨도록 배치 — 타이틀바가 커서 바로 아래(약간 좌상)에
 * 오게 해 "클릭한 자리에서 팝업" 느낌. 화면 밖이면 clampRect로 안으로 보정. 링크 클릭 등 포인터가
 * 있는 열기에 사용(없으면 cascadeNext). restoreUnderPointer와 같은 "커서 아래" 컨벤션.
 */
export function rectAtPoint(sx: number, sy: number, bounds: Bounds, size = DEFAULT_WINDOW): Rect {
  const w = Math.min(size.w, Math.max(MIN_W, bounds.width - 40));
  const h = Math.min(size.h, Math.max(MIN_H, bounds.height - 40));
  return clampRect({ x: sx - 20, y: sy - 14, w, h }, bounds);
}

/** 새 창 기본 위치 — 인덱스만큼 cascade 오프셋(겹쳐 쌓이지 않게), 화면 넘으면 wrap. */
export function cascadeNext(count: number, bounds: Bounds, size = DEFAULT_WINDOW): Rect {
  const w = Math.min(size.w, Math.max(MIN_W, bounds.width - 40));
  const h = Math.min(size.h, Math.max(MIN_H, bounds.height - 40));
  const step = 28;
  const span = Math.max(0, Math.min(bounds.width - w, bounds.height - h) - 24);
  const offset = span > 0 ? (count * step) % (span + 1) : 0;
  return clampRect({ x: 24 + offset, y: 24 + offset, w, h }, bounds);
}

/**
 * 스포트라이트 포커스 창 영역 — 상단 중앙 큰 박스(하단 ~40%는 커버 스트립 몫).
 * 폭 min(스테이지-32, 1100), 높이 ≈ 60%, 좌우 중앙, top 16. clampRect로 최소크기 보정.
 */
export function spotlightTop(bounds: Bounds): Rect {
  const w = Math.min(bounds.width - 32, 1100);
  const h = Math.round(bounds.height * 0.6);
  const x = Math.round((bounds.width - w) / 2);
  return clampRect({ x, y: 16, w, h }, bounds);
}

/**
 * 스포트라이트 상단 타일 — 올라온 창(spotlightRaised) count개를 상단 영역에 가로로 균등 타일.
 * count<=1이면 spotlightTop(중앙 큰 박스 1개). 2~3개면 좌우로 분할(가운데 gap). 하단 ~40%는 커버 스트립 몫.
 */
export function spotlightTile(bounds: Bounds, index: number, count: number): Rect {
  if (count <= 1) return spotlightTop(bounds);
  const margin = 16;
  const gap = 14;
  const h = Math.round(bounds.height * 0.6);
  const areaW = bounds.width - margin * 2;
  const w = Math.round((areaW - gap * (count - 1)) / count);
  const x = margin + index * (w + gap);
  return clampRect({ x, y: 16, w, h }, bounds);
}

/** 스냅 존 → 목표 사각형(좌/우 절반·전체 최대화·1/4 모서리). */
export function snapTarget(zone: SnapZone, bounds: Bounds): Rect | null {
  const hw = Math.round(bounds.width / 2);
  const hh = Math.round(bounds.height / 2);
  switch (zone) {
    case "left":
      return { x: 0, y: 0, w: hw, h: bounds.height };
    case "right":
      return { x: bounds.width - hw, y: 0, w: hw, h: bounds.height };
    case "top":
      return { x: 0, y: 0, w: bounds.width, h: hh };
    case "bottom":
      return { x: 0, y: bounds.height - hh, w: bounds.width, h: hh };
    case "max":
      return { x: 0, y: 0, w: bounds.width, h: bounds.height };
    case "tl":
      return { x: 0, y: 0, w: hw, h: hh };
    case "tr":
      return { x: bounds.width - hw, y: 0, w: hw, h: hh };
    case "bl":
      return { x: 0, y: bounds.height - hh, w: hw, h: hh };
    case "br":
      return { x: bounds.width - hw, y: bounds.height - hh, w: hw, h: hh };
    default:
      return null;
  }
}

/**
 * 드래그 포인터가 캔버스 가장자리 근처면 스냅 존 반환.
 * 우선순위: 모서리(1/4) > 상/하/좌/우 가장자리(절반). 좌/우 가장자리에 닿은 채
 * 상·하 corner 밴드 안이면 1/4, 가운데면 절반. (최대화는 드래그 아닌 버튼/더블클릭)
 */
export function snapZoneForPoint(
  px: number,
  py: number,
  bounds: Bounds,
  edge = 24,
  corner = 80,
): SnapZone {
  const nearLeft = px <= edge;
  const nearRight = px >= bounds.width - edge;
  if (nearLeft && py <= corner) return "tl";
  if (nearRight && py <= corner) return "tr";
  if (nearLeft && py >= bounds.height - corner) return "bl";
  if (nearRight && py >= bounds.height - corner) return "br";
  if (py <= edge) return "top";
  if (py >= bounds.height - edge) return "bottom";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return null;
}

export type LayoutTemplate = "split" | "stack" | "thirds";

/**
 * 레이아웃 템플릿 → 슬롯 사각형 배열(슬롯0 = 앵커 위치). Snap Assist 자동 타일링용.
 * anchorSide = 앵커가 놓인 쪽. split=좌우 절반, stack=앵커 full-half + 반대 상/하 ¼(1+2),
 * thirds=세로 3컬럼(앵커가 자기 쪽 끝 컬럼). 각 슬롯 clampRect.
 */
export function layoutSlots(
  template: LayoutTemplate,
  bounds: Bounds,
  anchorSide: "left" | "right",
): Rect[] {
  const W = bounds.width;
  const H = bounds.height;
  const hw = Math.round(W / 2);
  const hh = Math.round(H / 2);
  const left = anchorSide === "left";
  let slots: Rect[];
  if (template === "split") {
    const a = left ? { x: 0, y: 0, w: hw, h: H } : { x: W - hw, y: 0, w: hw, h: H };
    const b = left ? { x: W - hw, y: 0, w: hw, h: H } : { x: 0, y: 0, w: hw, h: H };
    slots = [a, b];
  } else if (template === "stack") {
    const a = left ? { x: 0, y: 0, w: hw, h: H } : { x: W - hw, y: 0, w: hw, h: H };
    const sx = left ? W - hw : 0;
    slots = [a, { x: sx, y: 0, w: hw, h: hh }, { x: sx, y: H - hh, w: hw, h: hh }];
  } else {
    const t = Math.round(W / 3);
    const cols = [
      { x: 0, y: 0, w: t, h: H },
      { x: t, y: 0, w: W - 2 * t, h: H },
      { x: W - t, y: 0, w: t, h: H },
    ];
    slots = left ? [cols[0], cols[1], cols[2]] : [cols[2], cols[1], cols[0]];
  }
  return slots.map((r) => clampRect(r, bounds));
}

// ── Snap Layouts 바 (Windows 11식, 드래그 중 상단 레이아웃 선택) ──────────────
type Frac = { x: number; y: number; w: number; h: number };

/** 템플릿 → 고정방향 분수 슬롯(0~1). 좌=좌, 1+2=좌1·우2. clamp 없음(바·미리보기 공용). */
export function templateFractions(t: LayoutTemplate): Frac[] {
  if (t === "split") {
    return [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ];
  }
  if (t === "stack") {
    return [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
  }
  return [
    { x: 0, y: 0, w: 1 / 3, h: 1 },
    { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
    { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
  ];
}

/** 분수 슬롯 × bounds → 실제 rect(clamp). */
export function templateSlots(t: LayoutTemplate, bounds: Bounds): Rect[] {
  return templateFractions(t).map((f) =>
    clampRect({ x: f.x * bounds.width, y: f.y * bounds.height, w: f.w * bounds.width, h: f.h * bounds.height }, bounds),
  );
}

/** 열린 창 수에 맞는 바 템플릿 목록. */
export function snapBarTemplates(count: number): LayoutTemplate[] {
  if (count >= 3) return ["split", "stack", "thirds"];
  if (count === 2) return ["split"];
  return [];
}

const BAR = { cell: 92, diagH: 52, gap: 10, padX: 10, padY: 8, labelH: 16, top: 14 };

export type SnapBar = {
  x: number;
  y: number;
  w: number;
  h: number;
  items: { template: LayoutTemplate; box: Rect; cells: Frac[] }[];
};

/** 상단 중앙 스냅 레이아웃 바의 기하(스테이지 좌표). 렌더·히트테스트 단일 소스. count<2면 null. */
export function snapBar(bounds: Bounds, count: number): SnapBar | null {
  const templates = snapBarTemplates(count);
  const n = templates.length;
  if (n === 0) return null;
  const { cell, diagH, gap, padX, padY, labelH, top } = BAR;
  const w = n * cell + (n - 1) * gap + padX * 2;
  const h = diagH + labelH + padY * 2 + 4;
  const x = Math.round((bounds.width - w) / 2);
  const y = top;
  const items = templates.map((t, i) => {
    const bx = x + padX + i * (cell + gap);
    const by = y + padY;
    const box = { x: bx, y: by, w: cell, h: diagH };
    const cells = templateFractions(t).map((f) => ({
      x: bx + f.x * cell,
      y: by + f.y * diagH,
      w: f.w * cell,
      h: f.h * diagH,
    }));
    return { template: t, box, cells };
  });
  return { x, y, w, h, items };
}

/** 스테이지 로컬 포인터가 바의 어느 템플릿·슬롯 위인지(없으면 null). */
export function snapBarHitTest(
  px: number,
  py: number,
  bounds: Bounds,
  count: number,
): { template: LayoutTemplate; slot: number } | null {
  const bar = snapBar(bounds, count);
  if (!bar) return null;
  if (px < bar.x || px > bar.x + bar.w || py < bar.y || py > bar.y + bar.h) return null;
  for (const item of bar.items) {
    for (let s = 0; s < item.cells.length; s++) {
      const c = item.cells[s];
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) {
        return { template: item.template, slot: s };
      }
    }
  }
  return null;
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/**
 * 리사이즈 바닥 — 그 창의 최소 크기(`windowMinSize`)를 캔버스 안으로 접은 값. 전역 MIN_W/MIN_H가 절대 하한.
 * 힌트("최소 크기 1120×720")를 띄우는 쪽(use-pointer-resize)도 같은 함수로 바닥을 알아본다.
 */
export function resizeFloor(min: { w: number; h: number } | undefined, bounds: Bounds): { w: number; h: number } {
  return {
    w: Math.max(MIN_W, Math.min(min?.w ?? MIN_W, bounds.width)),
    h: Math.max(MIN_H, Math.min(min?.h ?? MIN_H, bounds.height)),
  };
}

/**
 * 8방향 핸들 리사이즈 — 델타 적용 + 최소크기(이동변 보정) + 캔버스 clamp.
 * `min` = 그 창의 최소 크기(라우트 창은 `windowMinSize`). 없으면 전역 MIN_W/MIN_H.
 */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Bounds,
  min?: { w: number; h: number },
): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;

  if (handle.includes("e")) right = rect.x + rect.w + dx;
  if (handle.includes("s")) bottom = rect.y + rect.h + dy;
  if (handle.includes("w")) left = rect.x + dx;
  if (handle.includes("n")) top = rect.y + dy;

  const floor = resizeFloor(min, bounds);
  if (right - left < floor.w) {
    if (handle.includes("w")) left = right - floor.w;
    else right = left + floor.w;
  }
  if (bottom - top < floor.h) {
    if (handle.includes("n")) top = bottom - floor.h;
    else bottom = top + floor.h;
  }

  return clampRect({ x: left, y: top, w: right - left, h: bottom - top }, bounds);
}

/** id를 z-order 맨 앞(배열 끝)으로. idempotent. */
export function bringToFront(order: string[], id: string): string[] {
  return [...order.filter((i) => i !== id), id];
}
