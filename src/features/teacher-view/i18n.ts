/**
 * **강사뷰 화면 언어**(한국어 / English) — 사전 한 벌 + 순수 해석 함수.
 *
 * 원장 2026-09-03: *"강사뷰 화면을 영어/한글 전환할 수 있도록 원어민 전용뷰 세팅 (영어강사 기준)"*
 * → 범위 정정: *"강사로 로그인했을때 화면이야 '영어 강사 시트' 하나만 적용하는것이 아님"* ·
 * *"관리자뷰는 수정할 필요 없고 강사로 로그인했을때 내 메뉴에서 한영전환이 있으면 됨"*.
 * 🔴 그래서 이 사전은 **강사 미니셸 안에서만** 쓰인다 — 관리자(풀셸)는 한 글자도 안 바뀐다.
 * 실측(2026-09-03, injaewon 활성 32계정): 로마자 이름은 **정확히 2명**(`KRISTINE DRIVER`·`Florence Park`)
 * 이고 둘 다 `system_role=teacher`·`job_title=원어민`이다. 둘 다 **담임 반 0개**(교시 담당만, 전부 english)
 * 라 강사 홈이 ECS로 착지하고([`teacher-home-rule.ts`](@/lib/auth/teacher-home-rule)), 둘 다
 * **`ui_prefs = {}`** — 즉 아무것도 안 고른 상태라 **이름에서 도출되는 기본값이 곧 그들이 보는 화면**이다.
 * `lesson_reports` 작성은 둘 다 0건이고 출결 입력은 KRISTINE 30건·Florence 0건 — 그래서 우선순위는
 * **미니셸 크롬 → ECS → 출결**이고 원스크린(수업 마감)은 뒤로 미뤘다.
 *
 * ## 🔴 번역하는 것과 안 하는 것
 * - **번역한다**: 열 머리·버튼·상태 배지·툴팁·빈 화면 안내 — 즉 **우리가 쓴 UI 문구**.
 * - **절대 번역하지 않는다**: 교재명 · 진도 · 특이사항 · 학교명 · 프로그램 이름(`EiE`·`인재원 영어`) —
 *   **사람이 입력한 사실**이다. 옮기면 그 자리에서 사실이 바뀐다.
 * - **⚠️ 2026-09-03에 원장이 셋을 이 금지 목록에서 빼냈다**(각각 다른 이유로 안전하다):
 *   · **학생 이름** → 저장된 `students.english_name`으로 **고른다**([`student-name.ts`](./student-name.ts)).
 *   · **강사 이름** → 저장된 `users.english_name`으로 **고른다**([`teacher-name.ts`](./teacher-name.ts)).
 *     둘은 번역이 아니라 **이미 있는 값 중 하나를 고르는 것**이라 사실이 바뀌지 않는다.
 *   · **반 이름** → 낱말 표로 **표기만** 옮긴다([`class-name.ts`](./class-name.ts)). 이름이 문장이 아니라
 *     `밴드_학년 레벨 반구분` 고정 문법이고 **구조를 하나도 안 바꾸므로**, 한국인 강사와 원어민이
 *     같은 반을 이야기하고 있다는 걸 눈으로 대조할 수 있다(모르는 낱말은 한글로 남긴다).
 *   🔴 셋 다 **표시 전용**이고 학부모·사무실 표면(ClassNote·보고서·엑셀·인쇄)은 한국어 고정이다 —
 *      각 모듈의 구조 가드가 그 경로들의 import를 막는다.
 * - 🔴 **AI 번역 호출 금지**(원장 지시) — 사전은 코드에 박힌 정적 표다. 런타임 번역은 비용·지연·환각을
 *   한꺼번에 들여오고, 같은 버튼이 열 때마다 다른 글자가 될 수 있다.
 *
 * ## ⚠️ 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것
 * 서버 컴포넌트(랜딩 `page.tsx`)와 클라 컴포넌트(툴바)가 **같은 사전**을 읽는다. 한쪽 표시를 위해
 * 사전을 두 벌로 나누면 같은 버튼이 화면마다 다른 말을 한다([[#61]]·[[#81]]).
 *
 * ## 폴백 규약
 * `en`이 비어 있으면 **한글을 그대로** 낸다(빈 문자열·키 노출 금지 — 원장 규약 "UI에 raw 코드 노출 금지").
 * 반쯤 번역된 화면은 못난 대신 **정직**하고, 빈 버튼은 고장으로 읽힌다.
 */
import { isKoreanTeacherName } from "@/features/timetable/lib/teacher-label";

export const SHEET_LANGS = ["ko", "en"] as const;
export type SheetLang = (typeof SHEET_LANGS)[number];

/**
 * provider가 없는 곳에서 읽힐 때의 값 = **한국어**.
 *
 * 🔴 이 기본값을 `en`으로 돌리지 말 것 — provider는 **강사 미니셸에만** 걸려서, 관리자 풀셸과
 *    창(iframe)에서 같은 공용 조각(`SheetClassPicker` 등)이 이 값으로 떨어진다. 여기가 `en`이면
 *    **관리자뷰가 영어가 된다**(원장 2026-09-03 *"관리자뷰는 수정할 필요 없고"*를 정면으로 어긴다).
 * ⚠️ MCS(수학 시트)는 이제 provider **안**이다 — 강사가 여는 화면 전체가 범위이므로 원어민에겐
 *    수학 시트도 영어로 열린다(ECS 한 화면이던 1차 범위에서 넓어진 것).
 */
export const DEFAULT_SHEET_LANG: SheetLang = "ko";

/**
 * 언어 스위치에 적는 이름 — **번역하지 않는다**(언어 이름은 그 언어로 적는 것이 만국 관행이고,
 * 그래야 지금 화면을 못 읽는 사람도 자기 언어를 찾을 수 있다).
 */
export const SHEET_LANG_LABEL: Record<SheetLang, string> = { ko: "한국어", en: "English" };

/** 저장값·URL 등 바깥에서 온 값 → 언어. 모르는 값은 null(호출부가 기본값을 정한다). */
export function parseSheetLang(raw: unknown): SheetLang | null {
  return (SHEET_LANGS as readonly unknown[]).includes(raw) ? (raw as SheetLang) : null;
}

/**
 * **아직 한 번도 안 고른 사람**의 기본 언어 — 표시 이름으로 가른다.
 *
 * 판정은 [`isKoreanTeacherName`](@/features/timetable/lib/teacher-label) **단일 소스**(이름에 한글이
 * 하나라도 있으면 한국인). 🔴 `job_title`의 "원어민" 라벨로 판정하지 않는다 — 그건 학원설정 운영
 * enum이라 원장이 라벨을 고치는 순간 판정이 **조용히 뒤집힌다**(그 파일의 🔴 주석 그대로).
 *
 * ⚠️ 이건 **기본값일 뿐 잠금이 아니다** — 고른 값이 있으면 언제나 그것이 이긴다([`resolveSheetLang`]).
 *    이름은 휴리스틱이라(한글로 등록된 원어민, 로마자로 등록된 한국인) 틀릴 수 있고, 틀렸을 때
 *    본인이 되돌릴 수 있어야 한다. 그래서 스위치는 **전원에게 보인다**(가시성을 이 판정에 묶지 않는다).
 */
export function defaultSheetLangFor(displayName: string | null | undefined): SheetLang {
  return isKoreanTeacherName(displayName) ? "ko" : "en";
}

/**
 * 실제 언어 — **순서가 곧 결정**이다:
 *   ① 본인이 고른 값(`ui_prefs.teacherView.lang`)
 *   ② 관리자가 지정한 기본값(`users.teacher_view_lang`, 0248a)
 *   ③ 표시 이름에서 도출(`defaultSheetLangFor`)
 *
 * 🔴 **본인 선택이 맨 위다** — 관리자가 `en`으로 지정해도 본인이 한국어를 고르면 한국어다.
 *    스위치를 전원에게 연 것과 같은 논리(표시 판정을 능력 판정으로 만들지 않는다): 관리자 지정은
 *    "이 사람은 아마 이 언어일 것"이라는 **더 나은 기본값**이지, 본인을 가두는 잠금이 아니다.
 * 🔴 ②는 **왜 필요한가**: ③의 이름 휴리스틱은 로마자 이름만 잡는다. 원장 2026-09-03 *"샘 킴 (sam)도
 *    원어민에 등록"* — 샘 킴 = 김태건이라 이름이 한글이라 휴리스틱이 못 잡는다.
 * 🔴🔴 ②는 **담임 판정과 아무 상관이 없다**(0248a 주석) — `isKoreanTeacherName`은 이 값을 읽지 않고,
 *    앞으로도 읽게 만들지 말 것. 김태건은 담임 반이 4개다.
 */
export function resolveSheetLang(
  stored: unknown,
  adminDefault: unknown,
  displayName: string | null | undefined,
): SheetLang {
  return parseSheetLang(stored) ?? parseSheetLang(adminDefault) ?? defaultSheetLangFor(displayName);
}

/**
 * 사전 한 벌. 키는 `구역.이름`(구역 = lang/face/chrome/toolbar/landing/today/nav/filter).
 *
 * ⚠️ 새 문구를 넣을 땐 **ko·en 둘 다** 적는다(en을 비우면 폴백이 한글을 내지만, 그건 미번역 표시지
 *    설계가 아니다). 가드 `i18n.test.ts`가 빈 값·한글 혼입·구역 목록을 잡는다.
 * 🔴 **쓰지 않을 키를 미리 넣지 말 것**(학원설정의 write-only-orphan과 같은 함정) — 넓힐 땐 **배선과
 *    같은 푸시에서** 키를 더한다.
 * 지금 범위 = 상단 바·네비·랜딩 프레임 + **시트 본문**(계획 표·로스터·출결·퇴원·오늘 면 카드·요약).
 * 아직 한국어로 남은 것 = 월간 뷰 3종 · 자리(JJ·LAB) 출석부 · MCS 칸 문구 · 알림 벨 · 원스크린.
 */
export const SHEET_DICT = {
  // ── 언어 스위치 자체('내 메뉴' 드롭다운 안) ───────────────────────
  "lang.label": { ko: "언어", en: "Language" },
  "lang.title": {
    // ⚠️ 이 문구는 **약속**이다 — 실제 동작이 바뀌면 함께 고칠 것(2026-09-03: 학생·강사 이름과 반 이름이
    //    영어 화면에서 바뀌게 되어 "번역하지 않습니다" 목록에서 빼냈다).
    ko: "강사 화면의 언어 — 내 계정에 저장되어 다른 PC에서도 같은 언어로 열립니다. English로 보면 영어 이름이 등록된 학생·강사는 그 이름으로, 반 이름은 영문 표기로 보입니다. 교재·진도·특이사항처럼 직접 입력한 내용은 번역하지 않습니다.",
    en: "Language for your teacher screens. Saved to your account, so it opens the same way on any PC. In English, students and teachers who have an English name are shown by it, and class names use their English form. Books, lesson progress and notes you type are never translated.",
  },
  "lang.aria": { ko: "화면 언어 선택", en: "Choose display language" },
  "lang.saveFailed": {
    ko: "화면 언어를 저장하지 못했습니다",
    en: "Could not save your display language",
  },

  // ── 강사 미니셸 크롬('내 메뉴' 드롭다운 · 헤더) ────────────────────
  // 🔴 원어민이 **항상** 보는 프레임이라 우선순위 1이다. 라벨은 [teacher-menu](@/components/teacher-menu)의
  //    `LINKS`와 **같은 뜻**이어야 한다 — 키는 그 줄의 `menu`(MenuKey)를 그대로 쓴다(갈리면 새 메뉴가
  //    조용히 한글로 남는다).
  "menu.trigger": { ko: "내 메뉴", en: "My menu" },
  "menu.heading": { ko: "강사 메뉴", en: "Teacher menu" },
  "menu.me": { ko: "내 정보", en: "My profile" },
  "menu.toAdmin": { ko: "관리자뷰로 전환", en: "Switch to admin view" },
  "menu.item.attendanceQuick": { ko: "출결 모드", en: "Quick attendance" },
  "menu.item.teacher_onescreen": { ko: "수업 마감 (원스크린)", en: "Lesson wrap-up (One Screen)" },
  "menu.item.ecs": { ko: "영어 강사 시트", en: "English Teacher Sheet" },
  "menu.item.mcs": { ko: "수학 강사 시트", en: "Math Teacher Sheet" },
  "menu.item.students": { ko: "내 학생", en: "My students" },
  "menu.item.attendance": { ko: "출석부", en: "Attendance book" },
  "menu.item.classes": { ko: "내 수업", en: "My classes" },
  "menu.item.timetable": { ko: "시간표", en: "Timetable" },
  "menu.item.exams": { ko: "성적관리", en: "Grades" },
  "menu.item.consultations": { ko: "학생상담", en: "Student counseling" },
  "menu.item.textbook_requests": { ko: "교재 요청", en: "Textbook requests" },
  "menu.item.expense_requests": { ko: "지출결의서", en: "Expense request" },
  // 🔴 ECS 월간 보기의 `달력`(face.cal)과 **다른 것**이다 — 이쪽은 학원 공용 일정 탭이라 영어도 갈라 적는다.
  "menu.item.calendar": { ko: "캘린더", en: "Academy calendar" },
  "menu.item.approvals": { ko: "전자결재", en: "Approvals" },
  "menu.item.class_review": { ko: "수업 평가", en: "Class review" },
  "menu.item.documents": { ko: "데이터베이스", en: "Documents" },

  // ── 면 전환(주간 | 달력 | 진도표 | 계획) ──────────────────────────
  "face.week": { ko: "주간", en: "Weekly" },
  "face.cal": { ko: "달력", en: "Calendar" },
  // 🔴 계획 표의 '진도' 열(`plan.col.progress` = Progress)과 **다른 것**이다 — 이쪽은 날짜별 진도를
  //    모아 보는 **보기(표)**이고 저쪽은 그 날 무엇을 나갔는지 적는 **칸**이다. 영어로 둘 다 `Progress`면
  //    탭과 열이 같은 말이 되어 무엇을 누르는지 알 수 없다(가드 `lang-wiring`이 이 뭉침을 잡는다).
  "face.rail": { ko: "진도표", en: "Progress table" },
  "face.mp": { ko: "달력", en: "Calendar" },
  "face.week.title": {
    ko: "그 주의 출결·태도·수업계획을 함께 쓰는 화면",
    en: "Write attendance, attitude and lesson plans for the week in one place",
  },
  "face.cal.title": {
    ko: "한 달을 달력으로 — 날짜 칸을 누르면 그 날 계획을 그 자리에서 엽니다",
    en: "The month as a calendar — click a date to edit that day's plan in place",
  },
  "face.rail.title": {
    ko: "한 달을 진도표로 — 영역별로 무엇을 언제 나갔는지 가로로 훑습니다",
    en: "The month as a progress table — scan across to see what was covered when, by skill area",
  },
  "face.mp.title": {
    ko: "학부모에게 나가는 월간 계획서 — 미리 쓴 계획과 실제 진도를 나란히 대조하고 인쇄합니다",
    en: "The monthly plan sent to parents — compare your written plan against the actual lessons, then print",
  },

  // ── 상단 바 왼쪽 덩어리(목록 · 반 선택 · 반 정보) ─────────────────
  "chrome.list": { ko: "목록", en: "List" },
  "chrome.list.aria": { ko: "반 목록", en: "Class list" },
  "chrome.classPlaceholder": { ko: "반 선택", en: "Pick a class" },
  "chrome.classAria": { ko: "반 전환", en: "Switch class" },
  "chrome.classInfo": { ko: "반 정보 보기", en: "Class info" },
  // ⚠️ 반 이름은 호출부가 붙인다(번역 대상이 아니다) — 여기는 뒤에 오는 말만.
  "chrome.classInfo.suffix": { ko: "반 정보 보기", en: "class info" },
  "chrome.homeroom": { ko: "담임", en: "Homeroom" },

  // ── 주간 시트 툴바 ────────────────────────────────────────────────
  "toolbar.delegated": { ko: "위임", en: "Delegated" },
  // ⚠️ 담임 **이름 바로 뒤**에 붙는다 — 한국어는 이름과 띄어 쓰고(`이수진 선생님 반`) 영어는 붙여 쓴다
  //    (`Lee's class`). 그래서 앞 공백을 이 문자열이 들고 있다(JSX가 넣으면 영어가 어긋난다).
  "toolbar.delegated.own": { ko: " 선생님 반", en: "'s class" },
  "toolbar.delegated.other": { ko: "다른 선생님 반", en: "another teacher's class" },
  "toolbar.delegated.title": {
    ko: "이 기간에만 대신 맡은 위임 반입니다",
    en: "You are covering this class for a limited period",
  },
  "toolbar.prevWeek": { ko: "이전 주", en: "Previous week" },
  "toolbar.nextWeek": { ko: "다음 주", en: "Next week" },
  "toolbar.thisWeek": { ko: "눌러서 이번 주로", en: "Click for this week" },
  "toolbar.dow": { ko: "요일", en: "Day" },
  "toolbar.all": { ko: "전체", en: "All" },
  // v5 §10에서 요일 칩 줄이 `요일: 전체` 드롭다운이 됐다 — 트리거 접근성 이름과 항목 hint의 "오늘"이 새로 필요하다.
  "toolbar.dow.aria": { ko: "요일 필터", en: "Day filter" },
  "toolbar.today": { ko: "오늘", en: "Today" },
  // 🔴 `today.stat.attendance`(출결 = 찍은 학생 수)와 **다른 것**이다 — 이쪽은 출석부로 가는 링크다.
  "toolbar.attendance": { ko: "출석부", en: "Attendance book" },
  "toolbar.attendance.title": {
    ko: "반 출석부 열기",
    en: "Open the attendance book for this class",
  },
  "toolbar.jj": { ko: "JJ", en: "JJ" },
  "toolbar.jj.title": {
    ko: "JJ(집중자율수업실) 교시를 시트에 그릴지 — 숨기면 카드와 작성률에서 함께 빠집니다(쓴 기록은 지워지지 않습니다). LAB은 전용 출석부로 옮길 예정이라 항상 빠집니다.",
    en: "Whether JJ (self-study room) periods appear on the sheet. Hiding them also removes them from the completion rate; nothing you wrote is deleted. LAB is always excluded — it is moving to its own attendance book.",
  },
  "toolbar.show": { ko: "표시", en: "Show" },
  "toolbar.hide": { ko: "숨김", en: "Hide" },
  "toolbar.font": { ko: "글씨", en: "Text" },
  "toolbar.font.title": {
    ko: "계획 패널·주간 시트의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다",
    en: "Text size for the plan panel and weekly sheet (your account) — the same size on any PC",
  },
  "toolbar.font.sm": { ko: "작음", en: "Small" },
  "toolbar.font.md": { ko: "보통", en: "Medium" },
  "toolbar.font.lg": { ko: "큼", en: "Large" },
  "toolbar.saved": { ko: "저장됨", en: "Saved" },
  "toolbar.saving": { ko: "저장 중…", en: "Saving…" },
  "toolbar.conflict": { ko: "충돌", en: "Conflicts" },
  "toolbar.conflict.hint": { ko: "건 — 셀에서 선택", en: " — resolve in the cell" },
  "toolbar.planPanel": { ko: "계획 패널", en: "Plan panel" },

  // ── 랜딩(페이지 머리·빈 화면) ─────────────────────────────────────
  "landing.eyebrow": { ko: "수업 운영", en: "Teaching" },
  "landing.title": { ko: "영어 강사 시트", en: "English Teacher Sheet" },
  "landing.desc": {
    ko: "영어 반별 주간 수업계획서/출석부",
    en: "Weekly lesson plans and attendance by English class",
  },
  "landing.empty.filtered.prefix": {
    ko: "지금 보기가",
    en: "Your current view is limited to",
  },
  // ⚠️ 개수(`trackCounts.all`)가 **문장 안에** 들어간다 — 괄호로 뒤에 붙이면 무엇의 수인지 사라진다.
  //    한국어는 수 뒤에 단위(`개 반`), 영어는 앞에(`all N classes`)라 꼬리를 따로 둔다.
  "landing.empty.filtered.suffix": {
    ko: "로 좁혀져 있어 표시할 반이 없습니다. 위 '프로그램'에서 전체를 누르면 ",
    en: ", so there are no classes to show. Press “All” under Program above to see all ",
  },
  "landing.empty.filtered.tail": {
    ko: "개 반이 모두 보입니다.",
    en: " classes.",
  },
  "landing.empty.noWeekClasses": {
    ko: "이 주에 수업이 배정된 영어 반이 없습니다. 위 주 이동으로 다른 주를 확인하세요.",
    en: "No English class has periods scheduled this week. Use the week arrows above to check another week.",
  },
  "landing.empty.notConfigured": {
    ko: "영어 과목의 수업계획(영어 강사 시트) 영역이 아직 설정되지 않았습니다. 학원 설정 → 과목 운영에서 영역을 지정하세요.",
    en: "Skill areas for the English lesson sheet have not been set up yet. Ask the office to set them in Academy Settings → Subjects.",
  },
  "landing.empty.none": {
    ko: "이 주에 운영 중인 영어 반이 없습니다.",
    en: "No English class is running this week.",
  },
  "landing.empty.noScoped.before": {
    ko: "담당하고 계신 영어 반이 없습니다. 수학 반을 맡고 계시면",
    en: "You have no English classes assigned. If you teach math, open the",
  },
  "landing.empty.noScoped.link": { ko: "수학 강사 시트", en: "Math Teacher Sheet" },
  "landing.empty.noScoped.after": {
    ko: "를 열어 주세요. 반 배정 문의는 사무실로.",
    en: ". For class assignments, please ask the office.",
  },

  // 목록 오른쪽 숫자 열의 **제목**(원장 2026-09-09 *"이게 샤우팅과 작성률이잖아. 상단 행제목 추가"*).
  // ⚠️ 열 폭은 **한글 머리 기준**(샤우팅 52px · 작성률 92px)이라 영어는 짧은 낱말로 고른다 — 길면
  //    `whitespace-nowrap` 제목이 왼쪽으로 흘러 옆 제목과 겹친다.
  "landing.col.shouting": { ko: "샤우팅", en: "Shouting" },
  "landing.col.rate": { ko: "주간 작성률", en: "Weekly fill" },
  // 행 끝 '달력' 진입로의 접근성 이름 — 🔴 **문장 전체**를 사전에 둔다(조각 `이름 + "달력 열기"`로
  //    이으면 영어 어순이 무너진다). 여는 면이 EiE(월간 계획서)든 인재원 영어(달력)든 사람에게는 '이 반의
  //    달력'이라 이름은 하나다.
  "landing.calendarLink": { ko: "{name} 달력 열기", en: "Open {name} calendar" },

  // ── '오늘' 면 ─────────────────────────────────────────────────────
  // 🔴 **문장 전체**를 담는다(조각 `머리+수+꼬리`로 두면 en 어순이 무너지고, 조각 하나가 다른 키와
  //    같은 영어가 되어 뜻이 뭉친다 — `Today`가 면 탭·창 라벨과 겹쳤다).
  "today.desc.today": {
    ko: "오늘 수업 {n}개 · 계획·출결·보고서를 한 화면에서",
    en: "Today — {n} classes · plans, attendance and reports on one screen",
  },
  "today.desc.day": {
    ko: "이 날 수업 {n}개 · 계획·출결·보고서를 한 화면에서",
    en: "This day — {n} classes · plans, attendance and reports on one screen",
  },
  "today.embed.today": { ko: "오늘", en: "Today" },
  "today.weekHint.before": { ko: "전체 반에 대한 내용을 보려면", en: "To see every class, open" },
  "today.weekHint.link": { ko: "‘주간 시트’", en: "“Weekly sheet”" },
  "today.weekHint.after": { ko: "에서 볼 수 있습니다.", en: "." },
  // 오늘 면 반 순서 드래그(2026-09-05) — 손잡이 하나와 실패 안내뿐이다(성공은 화면이 이미 말한다).
  "today.order.handleAria": { ko: "순서 이동", en: "reorder" },
  "today.order.handleTitle": { ko: "끌어서 반 순서 변경 (내 계정에 저장)", en: "Drag to reorder classes (saved to your account)" },
  "today.order.saveFail": { ko: "순서를 저장하지 못했습니다", en: "Could not save the order" },
  "today.holiday.today": { ko: "오늘은", en: "Today is" },
  "today.holiday.tail": {
    ko: "— 학원 휴일입니다. 수업이 있었다면 계획·출결·보고서를",
    en: "— an academy holiday. If you did teach, you can still write the plan, attendance and report",
  },
  "today.holiday.asUsual": { ko: "평소처럼 그대로", en: "exactly as usual" },
  // ⚠️ 앞의 굵은 조각(`asUsual`) 뒤에 **바로** 붙는다 — 한국어는 띄어쓰기, 영어는 쉼표라
  //    사이 공백을 JSX가 아니라 **이 문자열이** 들고 있어야 한다(둘 다 맞추려면 방법이 없다).
  "today.holiday.tail2": {
    ko: " 쓰실 수 있고, 쓰지 않은 휴일은 작성률에 잡히지 않습니다.",
    en: ", and holidays you leave blank are not counted against your completion rate.",
  },
  // ── 컴퓨터 알림 안내 배너 ─────────────────────────────────────────
  // ⚠️ 이 배너는 **강사 미니셸에서만** 렌더된다((shell)/layout.tsx `view === "teacher"`) — 그래도
  //    provider 밖(관리자)에서 읽히면 기본값 한국어라 어느 쪽이든 안전하다.
  // 🔴 ko 원문 교정 = **마침표 뒤 공백 하나뿐**(원장 2026-09-03 제보 "켜주세요.학부모가"). 굵은 조각과
  //    설명 조각을 JSX에서 붙여 놔 공백이 없었다. 뜻은 한 글자도 안 바꿨다.
  "banner.notify.title": { ko: "컴퓨터 알림을 켜주세요.", en: "Turn on desktop notifications." },
  "banner.notify.body": {
    ko: "학부모가 클래스노트에 새 글을 올리면 eywa 화면을 보고 있지 않아도 바로 알려드립니다. (브라우저가 물어보면 ‘허용’)",
    en: "When a parent posts on ClassNote, you'll be notified right away even if eywa isn't open. (If the browser asks, choose “Allow”.)",
  },
  "banner.notify.enable": { ko: "켜기", en: "Turn on" },
  "banner.notify.later": { ko: "나중에", en: "Later" },

  // ── '오늘 출석 미입력' 스트립 ─────────────────────────────────────
  // 🔴 수가 들어가는 문구는 **문장 전체**를 담고 자리만 뚫는다(`sheetTf`) — 조각 이어붙이기 금지.
  "strip.title": { ko: "오늘 출석 미입력", en: "Attendance not marked yet" },
  "strip.count": {
    ko: "{slots}개 교시 · {students}명",
    en: "{slots} periods · {students} students",
  },
  "strip.detailLink": { ko: "오늘 출결 자세히", en: "See today's attendance" },
  // 교시 칸 한 줄의 메타 — 시각은 데이터(번역 대상 아님)라 자리로만 받는다.
  "strip.slotMeta": { ko: "{time} · 미입력 {n}명", en: "{time} · {n} not marked" },
  // 명단 넘침 꼬리 — 🔴 앞 공백을 문자열이 들고 있다(한국어는 띄고 영어도 띈다).
  "strip.moreNames": { ko: " 외 {n}명", en: " +{n} more" },
  "strip.fillAll": { ko: "전원 출석", en: "All present" },
  "strip.detail": { ko: "자세히", en: "Details" },
  "strip.askDesk": { ko: "데스크에 확인 요청", en: "Ask front desk" },
  "strip.asked": { ko: "데스크에 요청함", en: "Request sent" },
  "strip.askDesk.title": {
    ko: "미입력 학생의 등원 확인을 데스크에 요청합니다",
    en: "Ask the front desk to confirm whether these students arrived",
  },
  "strip.saveFailed": {
    ko: "저장하지 못했습니다 — 다시 눌러 주세요",
    en: "Couldn't save — please press again",
  },
  "strip.requestFailed": {
    ko: "요청을 보내지 못했습니다 — 다시 눌러 주세요",
    en: "Couldn't send the request — please press again",
  },

  // ── '수정중' 동시편집 배지 ────────────────────────────────────────
  // 🔴 **이름은 번역하지 않는다**(사람 이름) — 자리로만 받는다.
  // ⚠️ 이 배지는 관리자 풀셸(수업목록·상담·등록상담)에서도 쓰인다 — provider 밖이라 한국어로 떨어진다.
  "presence.editing": { ko: "수정중", en: "Editing" },
  "presence.someone": { ko: "누군가", en: "someone" },
  "presence.more": { ko: " 외 {n}명", en: " +{n} more" },
  // ⚠️ 영어는 **`is/are`를 쓰지 않는다** — 이름이 하나일 수도 여럿일 수도 있어 어느 쪽을 골라도
  //    절반은 틀린 문장이 된다(한국어 `님이`는 수와 무관해 문제가 없다). 대시로 끊어 수를 안 드러낸다.
  "presence.title": {
    ko: "{names}님이 지금 이 항목을 수정 중입니다",
    en: "{names} — editing this item right now",
  },

  // ── 하루 일괄 입력 툴바 ───────────────────────────────────────────
  // 🔴 스트립의 `전원 출석`(strip.fillAll)과 **다른 동작**이라 영어도 달라야 한다 — 저쪽은 그 교시
  //    한 칸이고 이쪽은 **그 날 × 전 교시**다(뒤에 `7×1` 같은 범위가 붙는다). 한국어가 `전원`/`일괄`로
  //    갈라 놓은 것을 영어에서 둘 다 "Mark all present"로 뭉치면 눌러 보기 전엔 구분이 안 된다.
  "bulk.attendance": { ko: "일괄 출석", en: "Bulk present" },
  "bulk.attitude": { ko: "일괄 태도", en: "Bulk attitude" },
  "bulk.plan": { ko: "계획", en: "Plan" },
  "bulk.allDone": {
    ko: "이 날은 이미 전원 기록됐습니다",
    en: "Everyone is already marked for this day",
  },
  "bulk.noPerm": {
    ko: "출결 입력 권한이 없거나 수정 기간이 지났습니다",
    en: "You can't edit attendance here — no permission, or the edit window has closed",
  },
  "bulk.attitudePlaceholder": { ko: "태도 선택", en: "Choose attitude" },
  "bulk.attitudeChoose": { ko: "태도를 선택하세요", en: "Choose an attitude" },
  "bulk.attitudeApply": { ko: "\"{value}\" 적용 {n}칸", en: "Apply “{value}” to {n} cells" },
  "bulk.planTitle": {
    ko: "이 날 수업계획(평시/내신)을 한 번에 채우기",
    en: "Fill this day's lesson plan at once (regular / exam)",
  },
  // ⚠️ `평시`·`내신`(TERM_LABEL)은 **아직 안 옮겼다** — 그 라벨이 확인창·placeholder 등 긴 문장 6곳에
  //    끼워져 있어(조사 `(으)로` 포함) 라벨만 옮기면 문장이 반쯤 영어가 된다. 그 묶음을 통째로 옮길 때
  //    함께 넣을 것. 🔴 지금 키만 만들어 두지 않는다(orphan 금지 — 가드가 구역을 잠근다).

  // ── 팝업 공지 껍데기 ──────────────────────────────────────────────
  // 🔴 **본문·제목은 여기 없다** — 사람이 쓴 글이라 0249a 번역 캐시가 맡는다(정적 사전이 아니다).
  //    여기 있는 건 우리가 만든 **버튼·체크박스 글자**뿐이다.
  "popup.hideWeek": { ko: "7일간 보지 않기", en: "Hide for 7 days" },
  "popup.hideForever": { ko: "다시 보지 않기", en: "Don't show again" },
  "popup.close": { ko: "닫기", en: "Close" },
  "popup.more": { ko: "자세히 보기", en: "Learn more" },
  "popup.zoomTitle": { ko: "클릭하면 원본 크기로 봅니다", en: "Click to view full size" },
  "popup.zoomAria": { ko: "이미지 원본 크기로 보기", en: "View image at full size" },

  // ── '오늘' 면의 반 카드 머리 줄 ────────────────────────────────────
  // 🔴 반 이름은 **번역하지 않는다**(사람이 지은 이름) — 여기 있는 건 그 옆에 붙는 링크·안내뿐이다.
  "today.card.openWeek": { ko: "주간 시트 열기 →", en: "Open weekly sheet →" },
  "today.card.noOwnSlots": {
    ko: "이 날 이 반에 담당하시는 교시가 없습니다. 기록은 그대로 있고 주간 시트에서 보입니다.",
    en: "You have no periods in this class on this day. The records are still there — see them in the weekly sheet.",
  },
  "today.card.noClass": { ko: "이 날은 수업이 없습니다.", en: "No class on this day." },

  "today.empty.noClassScoped": {
    ko: "담당하고 계신 영어 반이 없습니다. 반 배정은 사무실에 문의하세요.",
    en: "You have no English classes assigned. Please ask the office about class assignments.",
  },
  "today.empty.noClass": {
    ko: "운영 중인 영어 반이 없습니다.",
    en: "No English class is currently running.",
  },
  // ⚠️ 머리 + 꼬리로 이어 붙인다 — 한국어는 주어에 조사가 붙고(오늘'은') 영어는 문장이 끝나므로,
  //    사이 공백을 **꼬리 문자열이** 들고 있어야 양쪽 다 맞는다.
  "today.empty.noLesson.today": { ko: "오늘은", en: "There are no classes today." },
  "today.empty.noLesson.day": { ko: "이 날은", en: "There are no classes on this day." },
  "today.empty.noLesson.tail": {
    ko: " 수업이 없습니다. 다른 날짜를 보시거나 '주간 시트'에서 이번 주 전체를 확인하세요.",
    en: " Try another date, or open “Weekly sheet” to see the whole week.",
  },

  // ── 면·모드·날짜 네비 ─────────────────────────────────────────────
  "nav.face": { ko: "보기", en: "View" },
  "nav.face.today": { ko: "오늘", en: "Today" },
  // 원장 2026-09-09: *"주간시트 / 305,JJ실 → 담임별 작성률 / JJ실 작성률"* → 곧이어 *"수정. 담임별/JJ실"*.
  // 🔴 두 칩은 **무엇으로 묶어 보는가**를 말한다(담임별로 묶은 반 목록 / JJ실 한 자리) — 화면 이름이 아니라
  //    보기 축이라 짧게 적는다. 영어도 같은 축으로.
  "nav.face.week": { ko: "담임별", en: "By homeroom" },
  "nav.face.room": { ko: "JJ실", en: "JJ room" },
  "nav.face.room.title": {
    ko: "305호 집중자율수업실 — 그 시각 여러 반을 한 표로",
    en: "Room 305 self-study — several classes at the same time in one table",
  },
  "nav.mode": { ko: "모드", en: "Mode" },
  "nav.mode.sheet": { ko: "시트", en: "Sheet" },
  "nav.mode.cards": { ko: "요약 카드", en: "Summary cards" },
  "nav.quickAttendance": { ko: "출결 모드", en: "Quick attendance" },
  "nav.quickAttendance.title": {
    ko: "오늘 내 수업의 출결만 터치로 빠르게 입력합니다",
    en: "Tap through attendance for today's classes only",
  },
  "nav.prevDay": { ko: "이전 날", en: "Previous day" },
  "nav.nextDay": { ko: "다음 날", en: "Next day" },
  "nav.today": { ko: "눌러서 오늘로", en: "Click for today" },

  // ── 랜딩 필터 ─────────────────────────────────────────────────────
  "filter.program": { ko: "프로그램", en: "Program" },
  "filter.program.title": {
    ko: "영어 프로그램별로 반 목록을 좁혀 봅니다(내 계정에 저장 — 다른 PC에서도 같은 상태로 열립니다)",
    en: "Narrow the class list by English program (saved to your account — the same on any PC)",
  },
  "filter.homeroom": { ko: "담임", en: "Homeroom" },
  "filter.homeroom.title": {
    ko: "담임별로 반 목록을 좁혀 봅니다(내 계정에 저장 — 다른 PC에서도 같은 상태로 열립니다)",
    en: "Narrow the class list by homeroom teacher (saved to your account — the same on any PC)",
  },
  "filter.homeroom.aria": { ko: "담임으로 반 목록 좁히기", en: "Filter classes by homeroom teacher" },
  "filter.homeroom.search": { ko: "담임 검색...", en: "Search teachers..." },
  "filter.all": { ko: "전체", en: "All" },
  "filter.saveFailed": {
    ko: "보기 설정을 저장하지 못했습니다",
    en: "Could not save your view setting",
  },

  // ── 수업계획 표(주간 시트·오늘 면이 같은 표를 쓴다) ────────────────
  // 🔴 열 폭은 **한글 머리가 한 줄에 들어가는 최소치**로 맞춰져 있다(today-columns ⚠️). 영어 머리가
  //    그보다 넓으면 머리가 두 줄이 되고, 나란한 카드 중 그 카드만 학생 줄이 밀려 `grid-rows-subgrid`
  //    줄맞춤이 깨진다. 그래서 여기 라벨은 **짧은 낱말**로 고른다(뜻은 title 툴팁이 받는다).
  "plan.col.kind": { ko: "구분", en: "Type" },
  "plan.col.book": { ko: "교재 / 내신교과서", en: "Book / Exam text" },
  "plan.col.pageTime": { ko: "페이지/시간", en: "Page/Time" },
  "plan.col.pageTime.title": {
    ko: "쪽수 또는 이 수업에 할당된 시간 — 둘 중 아무거나(예: 104p · 25분)",
    en: "Pages or the time given to this lesson — either one (e.g. 104p · 25 min)",
  },
  "plan.col.progress": { ko: "진도", en: "Progress" },
  "plan.col.homework": { ko: "과제", en: "Homework" },
  "plan.empty": { ko: "계획이 없습니다", en: "No lesson plan yet" },
  // 시기 칩 — 원본 시트가 계획 묶음을 가르는 큰 구분(평시 = 보통 주, 내신 = 학교 시험 대비 주).
  "plan.term.regular": { ko: "평시", en: "Regular" },
  "plan.term.exam": { ko: "내신", en: "Exam prep" },
  "plan.addRow": { ko: "+ 줄 추가", en: "+ Add row" },
  "plan.copy": { ko: "내용 복사 (지난 수업)", en: "Copy from previous lesson" },
  "plan.copy.title": {
    ko: "지난 수업에서 {term} 계획을 가져옵니다 — 강사 수업은 같은 요일·같은 교시, JJ 교시는 같은 교시의 지난 수업이 원본입니다(요일마다 교재가 달라서). 이미 쓴 칸은 그대로 두고 빈 칸만 채웁니다. JJ 교시는 학생별 듣기 레벨·누적 암기 단어수도 지난 기록에서 채웁니다(출결·태도는 복사하지 않습니다)",
    en: "Copies the {term} plan from the previous lesson — for a teacher's class the source is the same weekday and same period; for a JJ period it is the same period's previous lesson (books differ by weekday). Cells you already filled are left alone; only empty ones are filled. JJ periods also carry over each student's listening level and memorized words (attendance and attitude are never copied)",
  },

  // ── 로스터(학생) 표 머리 ──────────────────────────────────────────
  // ⚠️ 폭(px)은 `roster-form.ts`·`today-columns.ts`가 정한다 — 라벨만 여기서 고른다.
  "roster.notEnrolled": { ko: "이 교시 수강 대상이 아닙니다", en: "Not enrolled in this period" },
  "roster.unitsOnAbsent": {
    ko: "결석은 유닛(시수)을 쓰지 않습니다 — 출석·지각으로 바꾸면 입력할 수 있습니다",
    en: "Absences use no units — switch to present or late to enter one",
  },
  "roster.cellAria": { ko: "{name} {field}", en: "{name} {field}" },
  "roster.col.attendance": { ko: "출결", en: "Attend." },
  "roster.col.unit": { ko: "유닛", en: "Unit" },
  "roster.col.unit.title": {
    ko: "수업 1회 = 1유닛(기본). 시간·교시 길이와 상관없이 1이고, 다르면 여기서 고칠 수 있습니다. 급여 시수에 반영됩니다.",
    en: "One lesson = 1 unit by default, regardless of how long the period is. Change it here if it differs. This feeds teaching hours for payroll.",
  },
  "roster.col.attitude": { ko: "태도", en: "Attitude" },
  "roster.col.note": { ko: "특이사항", en: "Notes" },
  "roster.col.score": { ko: "시험 점수", en: "Score" },
  "roster.col.score.title": {
    ko: "이 교시의 시험 점수 — 자유 입력(18/20 · 95 · A 등)",
    en: "Test score for this period — free text (18/20 · 95 · A …)",
  },
  // 🔴 `Listening`(9자)은 48px 열에서 두 줄이 된다 — 짧은 `Level`을 쓰고 뜻은 툴팁이 말한다.
  "roster.col.listening": { ko: "듣기 레벨", en: "Level" },
  "roster.col.listening.title": {
    ko: "JJ(집중자율수업실) 듣기 레벨 — 자유 입력",
    en: "Listening level (JJ self-study room) — free text",
  },
  "roster.col.words": { ko: "누적 암기 단어수", en: "Words" },
  "roster.col.words.title": {
    ko: "지금까지 외운 누적 단어 수 — 자유 입력",
    en: "Cumulative memorized words — free text",
  },
  "roster.group.active": { ko: "학생", en: "Students" },
  "roster.group.makeup": { ko: "보강", en: "Makeup" },
  "roster.group.withdrawn": { ko: "퇴원", en: "Withdrawn" },
  "roster.group.record": { ko: "기록", en: "Records" },
  // 접기 버튼의 접근성 이름·설명(마우스 오버로도 보인다).
  "roster.group.listAria": { ko: "{name} 목록", en: "{name} list" },
  "roster.group.makeup.hint": {
    ko: "이 반 수강생은 아니지만 그날 보강으로 온 학생 — 출석부·원스크린과 같은 명단입니다",
    en: "Not enrolled in this class, but came that day for a makeup lesson — the same list as the attendance book and One Screen",
  },
  "roster.group.withdrawn.hint": {
    ko: "수강이 끝난 학생 — 종료일부터 한 달간 표시되고 그 뒤 주부터는 명단에서 빠집니다(읽기 전용)",
    en: "Students whose enrolment ended — shown for one month from the end date, then dropped from the list (read-only)",
  },
  "roster.group.record.hint": {
    ko: "현재 수강 대상이 아니지만 이 교시에 기록이 있어 표시(읽기 전용)",
    en: "Not currently enrolled, but shown because this period has a record (read-only)",
  },
  "common.expand": { ko: "펼치기", en: "Expand" },
  "common.collapse": { ko: "접기", en: "Collapse" },
  // 퇴원 한 줄 요약 안에서만 쓰는 조각(값이 있을 때만 붙는다).
  "withdrawn.reason": { ko: "사유", en: "Reason" },
  "withdrawn.attitude": { ko: "태도", en: "Attitude" },

  // ── 오늘 면 반 카드(머리 칩·상태 배지·일괄 출석·빈 명단) ──────────
  // ⚠️ 배지는 10px라 **문구가 곧 설명 전부**다 — 뜻은 title이 받는다(둘이 같은 말을 해야 한다).
  "today.students": { ko: "{n}명", en: "{n} students" },
  "today.chip.delegated": { ko: "위임", en: "Delegated" },
  "today.chip.live": { ko: "진행 중", en: "In progress" },
  "today.badge.plan": { ko: "계획 {done}/{total}", en: "Plan {done}/{total}" },
  "today.badge.plan.title": {
    ko: "오늘 교시 중 수업계획이 채워진 교시",
    en: "How many of today's periods have a lesson plan filled in",
  },
  "today.badge.attendance": { ko: "출결 {done}/{total}", en: "Attendance {done}/{total}" },
  "today.badge.attendance.title": {
    ko: "출결을 기록한 학생 수",
    en: "How many students have their attendance marked",
  },
  "today.badge.report": { ko: "보고서 {done}/{total}", en: "Reports {done}/{total}" },
  "today.badge.report.title": {
    ko: "수업보고서를 작성한 학생 수",
    en: "How many students have a lesson report written",
  },
  // ⚠️ ClassNote는 제품 이름이라 옮기지 않는다.
  "today.badge.notice.posted": { ko: "알림장 게시됨", en: "Notice posted" },
  "today.badge.notice.missing": { ko: "알림장 미게시", en: "Notice not posted" },
  "today.badge.notice.title": {
    ko: "ClassNote 반 보드에 이 날짜 알림장이 올라왔는지 — 연동 PC가 최대 30분 지연으로 반영합니다",
    en: "Whether this date's notice is up on the ClassNote class board — the sync PC updates this with up to 30 min delay",
  },
  "today.legend": { ko: "학생 · 출결 · 보고서", en: "Student · Attendance · Report" },
  // 🔴 `strip.fillAll`(한 교시 전원)과 **다른 것**이다 — 이쪽은 이 반 카드의 남은 학생이다.
  "today.bulkPresent.all": { ko: "전원 출석 ({n}명)", en: "Mark all present ({n})" },
  "today.bulkPresent.rest": { ko: "나머지 {n}명 출석", en: "Mark remaining {n} present" },
  "today.bulkPresent.title": {
    ko: "아직 출결이 없는 학생만 출석으로 기록합니다 — 이미 기록된 값(지각·결석 포함)은 건드리지 않습니다",
    en: "Marks present only where attendance is still empty — values already recorded (including late and absent) are never touched",
  },
  "today.noStudents": { ko: "이 날 수강하는 학생이 없습니다", en: "No students are enrolled on this day" },
  "today.noStudents.makeup": {
    ko: " — 보강으로 온 학생은 위에서 추가할 수 있습니다",
    en: " — you can add a student who came for a makeup lesson above",
  },
  "today.saveFailed.attendance": {
    ko: "출결 저장에 실패했습니다 — 네트워크 연결을 확인해 주세요",
    en: "Could not save attendance — please check your network connection",
  },
  "today.saveFailed.bulk": {
    ko: "일괄 출석 저장에 실패했습니다 — 네트워크 연결을 확인해 주세요",
    en: "Could not save bulk attendance — please check your network connection",
  },
  "today.saveFailed.clear": {
    ko: "출석 취소에 실패했습니다 — 네트워크 연결을 확인해 주세요",
    en: "Could not clear attendance — please check your network connection",
  },
  "today.saveFailed.fontSize": {
    ko: "글씨 크기를 계정에 저장하지 못했습니다 — 이 화면에서는 적용됩니다",
    en: "Could not save the text size to your account — it still applies on this screen",
  },

  // ── 태도 5단 눈금 ────────────────────────────────────────────────
  // 🔴 **저장값은 한국어 그대로**다(`ATTITUDE` = DB에 들어가는 문자열이고 학부모 카드가 그걸 읽는다).
  //    여기 있는 것은 **화면에 적는 글자**뿐이다 — 영어로 골라도 저장은 `매우 좋음`이다.
  // 오늘 카드 출결 알약(`today-attendance-pills.tsx`) — 잠긴 칸 문구는 일괄 바와 **같은 키**를 쓴다.
  // 오늘 면 '평시 내용 복사' — 주간 시트 버튼(`plan.copy*`)과 **문구가 다르다**(시기가 평시로 고정이라
  // 라벨에 그걸 밝힌다). 그래서 키를 따로 둔다: `{term}`을 끼우면 영어 문장에 한국어 낱말이 남는다.
  "today.link.weekSheet": { ko: "주간 시트 열기 →", en: "Open weekly sheet →" },
  "today.link.report": { ko: "수업보고서 쓰기 →", en: "Write lesson report →" },
  "today.copy": { ko: "평시 내용 복사 (지난 수업)", en: "Copy regular plan (previous lesson)" },
  "today.copy.busy": { ko: "복사 중…", en: "Copying…" },
  "today.copy.title": {
    ko: "지난 수업일에서 평시 계획을 가져옵니다 — 강사 수업은 같은 요일·같은 교시, JJ 교시는 같은 교시가 원본입니다(요일마다 교재가 달라서). 이미 쓴 칸은 그대로 두고 빈 칸만 채웁니다. JJ 교시는 학생별 듣기 레벨·누적 암기 단어수도 지난 기록에서 채웁니다(출결·태도는 복사하지 않습니다)",
    en: "Brings the regular plan from the previous lesson day — for a teacher's class the source is the same weekday and same period; for a JJ period it is the same period (books differ by weekday). Cells you already filled are left alone; only empty ones are filled. JJ periods also carry over each student's listening level and memorized words (attendance and attitude are never copied)",
  },
  "today.copy.unsaved": {
    ko: "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 지난 수업 내용을 복사할까요? (입력을 잃을 수 있습니다)",
    en: "Some entries are not saved yet (or are in conflict). Copy the previous lesson anyway? You may lose those entries.",
  },
  "today.copy.carryPending": {
    ko: "듣기 레벨·누적 암기 단어수 칸은 아직 준비 중입니다(관리자에게 문의하세요)",
    en: "Listening level and memorized-word cells are not ready yet — please ask the office",
  },
  // ⚠️ `{summary}`·`{source}`는 **서버가 만든 한국어 조각**이다(강사 이름·차시 요약) — 영어 화면에서도
  //    그 부분만 한국어로 남는다. 지어내 옮기지 않는다(사실을 바꾸는 것보다 섞이는 편이 낫다).
  "today.copy.carriedOnly": {
    ko: "{summary} 채웠습니다 — 지난 기록 값이라 바뀐 학생은 고쳐 주세요",
    en: "Filled {summary} — these come from past records, so fix anyone who changed",
  },
  "today.copy.none.filled": {
    ko: "빈 칸이 없어 채울 게 없습니다(이미 쓴 칸은 덮어쓰지 않습니다)",
    en: "Nothing to fill — there are no empty cells (filled cells are never overwritten)",
  },
  "today.copy.none.notEmpty": {
    ko: "이미 계획이 있는 교시라 복사하지 않았습니다(덮어쓰기 없음)",
    en: "This period already has a plan, so nothing was copied (no overwriting)",
  },
  "today.copy.none.sameDow": {
    ko: "복사할 지난 같은 요일 수업이 없습니다(최근 8주 안에 같은 요일·같은 교시의 평시 계획이 없습니다)",
    en: "No previous lesson on the same weekday to copy (no regular plan for this weekday and period in the last 8 weeks)",
  },
  "today.copy.none.any": {
    ko: "복사할 지난 수업이 없습니다(최근 8주 안에 같은 교시의 평시 계획이 없습니다)",
    en: "No previous lesson to copy (no regular plan for this period in the last 8 weeks)",
  },
  "today.copy.done": { ko: "{source}{n}줄 채웠습니다", en: "{source}filled {n} lines" },
  "today.copy.done.source": { ko: "{label} 수업에서 ", en: "From the {label} lesson, " },
  "today.copy.done.carry": { ko: " · {summary} 채움", en: " · {summary} carried over" },
  "today.copy.done.truncated": {
    ko: " — {n}줄은 20줄 상한이라 못 넣었습니다",
    en: " — {n} lines did not fit (20-line cap)",
  },
  "today.copy.failed": {
    ko: "내용 복사에 실패했습니다 — 네트워크 연결을 확인해 주세요",
    en: "Copy failed — check your network connection",
  },
  // 드롭다운(FieldSelect) 공통 문구 — 저장값은 그대로 두고 **표시만** 언어를 따른다.
  "select.legacy": { ko: "이전 표기", en: "Old label" },
  "select.search": { ko: "찾기", en: "Search" },
  "select.choose": { ko: "선택", en: "Choose" },
  // 오늘 카드 학생 기록 팝오버(태도·특이사항 + JJ 칸).
  "mark.attitudeAria": { ko: "{name} {slot} 태도", en: "{name} {slot} attitude" },
  "mark.noteAria": { ko: "{name} {slot} 특이사항", en: "{name} {slot} notes" },
  "mark.colAria": { ko: "{name} {slot} {field}", en: "{name} {slot} {field}" },
  "mark.notePlaceholder": {
    ko: "특이사항 (예: PL 7, 20개 / PV 4)",
    en: "Notes (e.g. PL 7, 20 words / PV 4)",
  },
  "mark.trigger.filled": {
    ko: "{name} 태도·특이사항 {n}건 — 열어서 고치기",
    en: "{name} — attitude and notes, {n} filled; open to edit",
  },
  "mark.trigger.empty": { ko: "{name} 태도·특이사항 입력", en: "Enter attitude and notes for {name}" },
  "mark.aria": { ko: "{name} 태도·특이사항", en: "{name} attitude and notes" },
  // ── 월간 뷰(달력·진도표·계획 MP) ──────────────────
  // 재사용: 계획=bulk.plan · 과제=plan.col.homework · 특이사항=roster.col.note · 닫기=popup.close
  // 담임=chrome.homeroom · 저장됨=toolbar.saved · 달력=face.cal · 접기/펼치기=common.*
  "month.prev": { ko: "이전 달", en: "Previous month" },
  "month.next": { ko: "다음 달", en: "Next month" },
  "month.current": { ko: "눌러서 이번 달로", en: "Click for this month" },
  "month.printDocTitle": { ko: "{class} {month} 계획서", en: "{class} {month} plan" },
  "month.fill.unit": { ko: "교시", en: "periods" },
  "month.fill.title": {
    ko: "이 달에 배정된 전 교시 기준입니다 — 아래 표시 토글(자리 교시)을 꺼도 이 숫자는 그대로입니다. 학원 휴일은 쓸 의무가 없어 분모에서 빠지고, 휴일에 쓴 계획은 그대로 인정됩니다. 주간 시트의 작성률은 그 주 표시 설정을 따르므로 두 숫자가 다를 수 있습니다.",
    en: "Counted against every period assigned this month — turning the seat-period toggle off does not change it. Academy holidays are outside the denominator, and a plan written on a holiday still counts. The weekly sheet follows that week's display settings, so the two numbers can differ.",
  },
  "month.offGoal": { ko: "목표 밖 교재", en: "Off-goal book" },
  "month.days": { ko: "{n}일", en: "{n} days" },
  "month.toggle.actual": { ko: "실제 함께 보기", en: "Show actual too" },
  "month.toggle.actual.title": {
    ko: "그 날 주간 시트에 실제로 적힌 진도를 계획 아래에 함께 보여줍니다. 신호(미작성·교재 다름) 숫자는 이 토글과 무관합니다",
    en: "Shows what was actually written in that day's weekly sheet under each plan. The signal counts (not written, different book) do not follow this toggle",
  },
  "month.print": { ko: "인쇄", en: "Print" },
  "month.print.title": {
    ko: "지금 화면의 계획을 A4 한 장으로 인쇄합니다(대조·경고는 실리지 않습니다)",
    en: "Prints the plan on screen as one A4 page (comparisons and warnings are not included)",
  },
  "month.toggle.homework.title": {
    ko: "계획 줄의 과제까지 보여줍니다",
    en: "Also shows the homework on each plan line",
  },
  "month.toggle.seat": { ko: "자리 교시(JJ)", en: "Seat periods (JJ)" },
  "month.toggle.seat.title": {
    ko: "랩실·JJ실 자리 교시 — 반 진도가 아니라 학생 개별 진도입니다. 표시만 바뀌고 작성률은 그대로입니다",
    en: "Lab and JJ seat periods — these are each student's own progress, not the class's. Only the display changes; the writing rate stays the same",
  },
  "month.error.goal": {
    ko: "목표를 저장하지 못했습니다 — {error} · 새로고침하면 마지막으로 저장된 값이 보입니다",
    en: "Could not save the goal — {error} · refresh to see the last saved value",
  },
  "month.error.plan": {
    ko: "계획을 저장하지 못했습니다 — {error} · 새로고침하면 마지막으로 저장된 값이 보입니다",
    en: "Could not save the plan — {error} · refresh to see the last saved value",
  },
  "month.mp.notReady": {
    ko: "월간 계획서 저장소가 아직 준비되지 않았습니다(DB 갱신 필요) — 관리자에게 알려주세요. 그때까지 적은 내용은 저장되지 않습니다.",
    en: "The monthly plan storage is not ready yet (the database needs an update) — please tell the office. Until then nothing you type here is saved.",
  },
  "month.mp.loadFailed": {
    ko: "월간 계획서를 불러오지 못했습니다 — 새로고침해 보시고, 계속되면 관리자에게 알려주세요.",
    en: "Could not load the monthly plan — try refreshing, and tell the office if it keeps happening.",
  },
  "month.noClasses": { ko: "이 달에는 수업이 없습니다.", en: "There are no classes this month." },
  "month.dowFull": { ko: "{dow}요일", en: "{dow}" },
  "month.weekTitle": { ko: "{m}월 {w}째 주 ({date} 시작)", en: "Week {w} of month {m} (starts {date})" },
  "month.weekUnit": { ko: "주", en: "wk" },
  "month.cell.holiday.edit": {
    ko: "{holiday} — 휴일입니다. 수업했다면 이 날 계획을 그대로 고칠 수 있습니다",
    en: "{holiday} — a holiday. If you did teach, you can still edit this day's plan",
  },
  "month.cell.holiday.view": {
    ko: "{holiday} — 휴일입니다. 수업했다면 이 날 계획을 그대로 볼 수 있습니다",
    en: "{holiday} — a holiday. If you did teach, you can still see this day's plan",
  },
  "month.cell.edit": { ko: "누르면 이 날 계획을 여기서 고칩니다", en: "Click to edit this day's plan here" },
  "month.cell.view": { ko: "누르면 이 날 계획을 여기서 봅니다", en: "Click to see this day's plan here" },
  "month.unwritten": { ko: "미작성", en: "Not written" },
  "month.unwrittenN": { ko: "미작성 {n}", en: "Not written {n}" },
  "month.allWritten.title": {
    ko: "이 날은 배정된 교시에 계획이 다 있습니다",
    en: "Every assigned period on this day has a plan",
  },
  "month.offGoalN": { ko: "목표 밖 {n}", en: "Off-goal {n}" },
  "month.noPlan": { ko: "계획 없음", en: "No plan" },
  "month.noTeacher": { ko: "담당 미지정", en: "No teacher set" },
  "month.homeworkLine": { ko: "과제 {v}", en: "Homework {v}" },
  "month.goalLine": { ko: "월간 목표: {book}", en: "Monthly goal: {book}" },
  "month.bookOnly": { ko: "교재만 · 진도 미기입", en: "Book only · no progress written" },
  "month.editor.toWeek": { ko: "주간 시트로", en: "To weekly sheet" },
  "month.editor.toWeek.title": {
    ko: "출결·태도·학생 칸까지 있는 주간 시트로 갑니다 — 여기 적은 내용을 저장한 뒤 이동합니다",
    en: "Goes to the weekly sheet, which also has attendance, attitude and student cells — what you typed here is saved first",
  },
  "month.editor.hint": {
    ko: "주간 시트와 같은 칸입니다 — 치는 대로 저장되고, 닫으면 이 달의 미작성·목표 밖 표시가 다시 계산됩니다.",
    en: "These are the same cells as the weekly sheet — they save as you type, and closing recalculates this month's not-written and off-goal marks.",
  },
  "month.editor.loading": { ko: "수업계획을 불러오는 중…", en: "Loading the lesson plan…" },
  "month.editor.noSlots": { ko: "이 날은 배정된 교시가 없습니다.", en: "No periods are assigned on this day." },
  "month.seat.title": {
    ko: "자리 교시 — 반 진도가 아니라 학생 개별 진도입니다",
    en: "Seat period — this is each student's own progress, not the class's",
  },
  "month.seat": { ko: "자리 · {seat}", en: "Seat · {seat}" },
  "month.rail.empty.a": {
    ko: "이 달에는 작성된 계획이 없습니다. 수업은 있는데 비어 있다면",
    en: "No plans were written this month. If there are classes but nothing here, the",
  },
  "month.rail.empty.b": { ko: "에서 어느 교시가 미작성인지 볼 수 있습니다.", en: "view shows which periods are missing." },
  "month.rail.goalHead": { ko: "영역 · 월간 목표", en: "Area · monthly goal" },
  "month.rail.footer": { ko: "그날 계획 / 배정 교시", en: "That day's plans / assigned periods" },
  "month.goal.sameAsWeek": { ko: "주간 시트와 같은 칸", en: "Same cell as the weekly sheet" },
  "month.goal.sameAsWeekFull": { ko: "주간 시트와 같은 칸입니다", en: "These are the same cells as the weekly sheet" },
  "month.goal.book": { ko: "교재명", en: "Book" },
  "month.goal.target": { ko: "목표", en: "Goal" },
  "month.goal.bookAria": { ko: "{area} 월간 목표 교재명", en: "{area} monthly goal book" },
  "month.goal.targetAria": { ko: "{area} 목표 진도", en: "{area} goal progress" },
  "month.goal.assistant": { ko: "부담임", en: "Assistant" },
  "month.goal.title": { ko: "{role} 월간계획", en: "{role} monthly plan" },
  "month.goal.none": { ko: "이 달 진행 없음", en: "Nothing covered this month" },
  "month.goal.actual": { ko: "실제", en: "Actual" },
  "month.goal.onTarget": { ko: "목표대로", en: "On target" },
  // 교재 이름 뒤에 붙는 여벌 수 — 사람 수(` 외 {n}명`)와 **다른 낱말**이어야 한다(가드).
  "month.goal.more": { ko: " 외 {n}", en: " (+{n})" },
  "month.memo.saveFailed": { ko: "저장에 실패했습니다(네트워크)", en: "Save failed (network)" },
  "month.memo.hint": { ko: "이 달 전체에 남는 메모입니다", en: "A note that stays for the whole month" },
  "month.memo.notReady": {
    ko: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요). 달력·진도표는 그대로 쓸 수 있습니다.",
    en: "The note field is not ready yet — please ask the office. The calendar and progress table still work.",
  },
  "month.memo.loadFailed": {
    ko: "메모를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.",
    en: "Could not load the note. Please refresh in a moment.",
  },
  "month.memo.placeholder": {
    ko: "이 달 전체에 남길 특이사항을 적습니다 (예: 9/16 시험 주간, 3주차 원어민 대체)",
    en: "Notes for the whole month (e.g. exam week on 9/16, native teacher covering week 3)",
  },
  "month.memo.aria": { ko: "{month} 특이사항 메모", en: "{month} monthly notes" },
  "mp.title": {
    ko: "휴강으로 표시한 날은 분모에서 빠집니다. 달력·진도표의 '계획 N/M교시'는 축이 교시라 이 숫자와 다릅니다.",
    en: "Days marked as no-class are outside the denominator. The calendar and progress table count periods, not days, so their numbers differ.",
  },
  // 🔴 인쇄물 본문은 **학부모 서식**이라 한국어 고정이다(별도 컴포넌트 `month-plan-paper`).
  //    아래는 화면 편집기의 크롬(접근성 이름·안내)뿐 — 서식 문구는 학원설정이 단일 소스다.
  "mp.footerAria": { ko: "월간 계획서 하단 문구", en: "Monthly plan footer text" },
  "mp.footerTitle": {
    ko: "눌러서 이 반의 하단 문구를 고칩니다",
    en: "Click to edit this class's footer text",
  },
  "mp.noSchedule": {
    ko: "이 달에는 이 반의 배정된 수업이 없습니다 — 계획을 적을 날짜가 없습니다.",
    en: "This class has no assigned lessons this month — there are no days to plan.",
  },
  "mp.footerEmpty": { ko: "눌러서 하단 문구를 적으세요", en: "Click to write the footer text" },
  "mp.ebook.dropConfirm": {
    ko: "{dow}의 e-book 열을 내리면 적어 둔 {n}칸이 함께 지워집니다. 계속할까요?",
    en: "Dropping the e-book column for {dow} also deletes the {n} cells written there. Continue?",
  },
  "mp.ebook.drop": { ko: "e-book 열 내리기", en: "Drop e-book column" },
  "mp.ebook.add": { ko: "+ e-book 열", en: "+ e-book column" },
  "mp.ebook.drop.title": {
    ko: "이 요일의 e-book 열을 내립니다(적어 둔 내용도 함께 지워집니다)",
    en: "Drops this weekday's e-book column (anything written there is deleted too)",
  },
  "mp.ebook.add.title": {
    ko: "이 요일에 e-book 열을 세웁니다",
    en: "Adds an e-book column for this weekday",
  },
  "mp.off": { ko: "휴강", en: "Mark as no class" },
  "mp.off.undo": { ko: "수업함으로", en: "Mark as taught" },
  "mp.off.title": {
    ko: "이 날을 휴강으로 표시합니다(인쇄물에 회색 '휴강'으로 나옵니다)",
    en: "Marks this day as no class (it prints greyed out)",
  },
  "mp.off.undo.title": {
    ko: "이 날 수업을 되살립니다(계획을 다시 적을 수 있습니다)",
    en: "Brings this day's lesson back (you can write a plan again)",
  },
  "mp.noRecord": { ko: "기록 없음", en: "No record" },
  "mp.noClassDay": { ko: "수업 없음", en: "No class" },
  "mp.dayUnit": { ko: "일", en: "days" },
  "mp.unwritten": { ko: "미작성", en: "Not written" },
  "mp.unwritten.title": {
    ko: "계획은 적었는데 그 날 주간 시트에 기록이 없는 날입니다",
    en: "Days with a plan but nothing written in that day's weekly sheet",
  },
  "mp.offBook": { ko: "교재 다름", en: "Different book" },
  "mp.offBook.title": {
    ko: "계획에 적은 교재가 그 날 기록 어디에도 없는 날입니다(쪽수는 대조하지 않습니다)",
    en: "Days where the planned book appears nowhere in that day's records (page numbers are not compared)",
  },
  "mp.noPlan": { ko: "계획 없음", en: "No plan" },
  "mp.noPlan.title": {
    ko: "기록은 있는데 계획 칸이 비어 있는 날입니다 — 경고가 아닙니다",
    en: "Days with records but an empty plan cell — this is not a warning",
  },
  // ── 내 정보(/me) — 계정·수업보고서 이름. 🔴 이력서 **종이 서식**은 인쇄물이라 한국어 고정.
  "me.back": { ko: "메인으로 돌아가기", en: "Back to main" },
  "me.eyebrow": { ko: "내 정보", en: "My profile" },
  "me.desc": {
    ko: "내 이력서와 로그인 정보를 직접 확인·수정합니다.",
    en: "View and edit your own resume and sign-in details.",
  },
  "me.embed": { ko: "{name} · 내 이력서와 로그인 정보", en: "{name} · resume and sign-in" },
  "me.saved": { ko: "저장했습니다", en: "Saved successfully" },
  "me.account": { ko: "내 계정", en: "My account" },
  "me.account.placeholder": {
    ko: "지금 로그인 주소는 임시로 만든 것입니다 — 본인 이메일로 바꾸고 비밀번호도 바꿔 주세요.",
    en: "Your current sign-in address is a placeholder — change it to your own email and set a new password.",
  },
  "me.account.desc": {
    ko: "로그인에 쓰는 이메일과 비밀번호를 직접 바꿀 수 있습니다.",
    en: "You can change the email and password you sign in with.",
  },
  "me.email": { ko: "로그인 이메일", en: "Sign-in email" },
  "me.email.hint.a": { ko: "바꾸면", en: "Once changed, the new address is used" },
  "me.email.hint.b": { ko: "다음 로그인부터", en: "from your next sign-in" },
  "me.email.hint.c": { ko: "새 주소를 씁니다. 지금 로그인은 그대로 유지됩니다.", en: "— your current session stays signed in." },
  "me.email.submit": { ko: "이메일 변경", en: "Change email" },
  "me.pw.new": { ko: "새 비밀번호", en: "New password" },
  "me.pw.min": { ko: "8자 이상", en: "At least 8 characters" },
  "me.pw.again": { ko: "새 비밀번호 확인", en: "Confirm new password" },
  "me.pw.againPh": { ko: "한 번 더", en: "Type it again" },
  "me.pw.submit": { ko: "비밀번호 변경", en: "Change password" },
  "me.reportName": { ko: "수업보고서 이름", en: "Lesson report name" },
  "me.reportName.desc.a": {
    ko: "학부모에게 나가는 수업보고서(클래스노트 게시·공유 링크·인쇄)에 표시할 이름입니다. 비워 두면 실명(",
    en: "The name shown on lesson reports that go to parents (ClassNote posts, share links, print). Leave it empty to send under your real name (",
  },
  "me.reportName.desc.b": { ko: ")으로 나갑니다.", en: ")." },
  "me.reportName.label": { ko: "발송에 표시할 이름", en: "Name to show on reports" },
  "me.reportName.ph": { ko: "예: 영어 이름", en: "e.g. your English name" },
  "me.save": { ko: "저장", en: "Save" },
  "me.reportName.blocked.a": {
    ko: "저장된 이름이 있지만 같은 이름의 직원이 있어 지금은",
    en: "You have a saved name, but another staff member has the same name, so reports currently go out",
  },
  "me.reportName.blocked.b": { ko: "실명으로 발송", en: "under your real name" },
  // ⚠️ 붙임/띄움이 언어마다 다르다 — 한국어는 `</b>되고`, 영어는 `</b> — please`.
  //    JSX에 `{" "}`를 박으면 한쪽이 틀리므로 **값 안에** 넣는다.
  "me.reportName.blocked.c": { ko: "되고 있습니다 — 관리자에게 문의하세요.", en: " — please ask the office." },
  "me.reportName.note.a": {
    ko: "다음 발송부터 새 이름으로 나가고,",
    en: "Reports sent from now on use the new name, and",
  },
  "me.reportName.note.b": { ko: "이미 보낸 보고서도", en: "reports already sent" },
  "me.reportName.note.c": {
    ko: "학부모가 공유 링크를 다시 열면 새 이름으로 보입니다(게시된 이미지 속 이름은 그대로).",
    en: "show the new name when a parent reopens the share link (the name inside a posted image stays as it was).",
  },
  "att.pill.noRecord": { ko: "출결 없음", en: "No attendance" },
  "att.pill.none": { ko: "출결 —", en: "Attendance —" },
  "att.groupAria": { ko: "{name} 출결", en: "{name} attendance" },
  "att.readonlyOther": {
    ko: "조퇴·공결·보강은 출석부에서 변경하세요(여기서 바꾸면 그 상태가 사라집니다)",
    en: "Change early leave, excused and makeup in the attendance book (changing it here would erase that status)",
  },
  "att.makeup.removeTitle": {
    ko: "클릭하면 보강 명단에서 뺍니다(출석 기록이 삭제됩니다)",
    en: "Click to remove from the makeup list (the attendance record is deleted)",
  },
  "att.makeup.removeAria": { ko: "{name} 보강 취소", en: "Cancel makeup for {name}" },
  "att.pill.editNote": {
    ko: "{label} — 사유 메모 수정(기록 지우기는 출석부에서)",
    en: "{label} — edit the reason note (clear the record in the attendance book)",
  },
  // ⚠️ 한국어 원문의 조사(`{label}로`)를 그대로 둔다 — ko 화면은 한 글자도 안 바뀐다는 규약이 먼저다.
  "att.pill.setWithNote": {
    ko: "{label}로 기록 — 사유 메모를 적을 수 있습니다",
    en: "Mark as {label} — you can add a reason note",
  },
  "att.pill.clear": {
    ko: "출석 취소 — 기록 없음으로 되돌립니다(사유·시수가 붙은 기록은 지워지지 않습니다)",
    en: "Undo present — back to no record (records that carry a reason or session count are kept)",
  },
  "att.pill.setPresent": { ko: "출석으로 기록", en: "Mark present" },
  "att.note.label": { ko: "{name} · {label} 사유", en: "{name} · {label} reason" },
  "roster.attitude.veryGood": { ko: "매우 좋음", en: "Very good" },
  "roster.attitude.good": { ko: "좋음", en: "Good" },
  "roster.attitude.ok": { ko: "보통", en: "Okay" },
  "roster.attitude.bad": { ko: "안좋음", en: "Poor" },
  "roster.attitude.veryBad": { ko: "매우 안좋음", en: "Very poor" },
  "roster.attitude.aria": { ko: "{name} 태도 — {value}", en: "{name} attitude — {value}" },

  // ── 오늘 면 계획 편집기(카드 안 계획 층) ─────────────────────────
  // ⚠️ placeholder는 계획 표 머리와 **같은 낱말**을 써야 한다(같은 값을 넣는 칸이다) — 그래서 `plan.col.*`을
  //    그대로 재사용하고 여기에 따로 적지 않는다. 여기 있는 것은 그 표에 없는 문구뿐이다.
  // 셀 충돌(CAS) 인라인 선택 — 주간 시트 계획 행(`plan-row.tsx`)과 오늘 면 계획
  // (`today-plan-editor.tsx`)이 **같은 UI를 두 벌** 들고 있어서, 문구는 여기 한 벌만 둔다.
  "cell.conflict.server": { ko: "다른 강사가 수정:", en: "Edited by another teacher:" },
  "cell.conflict.mine": { ko: "내 입력:", en: "My entry:" },
  "cell.conflict.empty": { ko: "(비움)", en: "(empty)" },
  "cell.conflict.useServer": { ko: "서버값 사용", en: "Use theirs" },
  "cell.conflict.useMine": { ko: "내 값으로 덮기", en: "Keep mine" },
  "plan.editor.title": { ko: "수업계획", en: "Lesson plan" },
  // 🔴 문장 전체를 사전에 둔다 — 이름만 끼우고 뒤를 JSX에 남기면 영어 화면에 한국어 어미가 붙는다.
  "plan.editor.presence": {
    ko: "{names} 님이 이 반을 수정 중입니다",
    en: "{names} is editing this class",
  },
  "plan.editor.presenceOther": { ko: "다른 사용자", en: "Another user" },
  "plan.editor.presenceHint": {
    ko: "— 같은 칸을 함께 고치면 저장할 때 알려 드립니다.",
    en: "— if you both edit the same cell, we'll tell you when it saves.",
  },
  "plan.editor.addElsewhere": {
    ko: "또는 ‘주간 시트’에서 줄 추가",
    en: "or add a row in the weekly sheet",
  },
  "plan.shouting.title": {
    ko: "이 교시에 Shouting을 했으면 체크하세요",
    en: "Tick this if you did Shouting in this period",
  },
  /** 입력칸 접근성 이름 — `{class} {field}`(반 이름 + 칸 이름). */
  "plan.editor.cellAria": { ko: "{class} {field}", en: "{class} {field}" },

  // ── 오늘 면 요약 스트립(빅 스탯 5칸) ─────────────────────────────
  // ⚠️ 칸이 좁아 **한 낱말**로 — 뜻이 겹치는 카드 배지(`today.badge.*`)와 같은 낱말을 쓴다.
  // 🔴 `chrome.list`(반 목록 버튼 = Classes)와 **다른 것**이다 — 이쪽은 "오늘 수업이 몇 개"라는 수다.
  "today.stat.classes": { ko: "수업", en: "Lessons" },
  "today.stat.classesValue": { ko: "{n}개", en: "{n}" },
  "today.stat.plan": { ko: "계획", en: "Plan" },
  "today.stat.attendance": { ko: "출결", en: "Attendance" },
  "today.stat.report": { ko: "보고서", en: "Reports" },
  "today.stat.notice": { ko: "알림장", en: "Notices" },
  "today.stat.noticeValue": { ko: "{done}/{total}반", en: "{done}/{total} classes" },
  // 학생 줄의 보고서 상태 — 발송/작성/미작성.
  "today.report.sent": { ko: "발송", en: "Sent" },
  "today.report.written": { ko: "작성", en: "Written" },
  "today.report.none": { ko: "미작성", en: "Not written" },
  "today.makeup.removed": { ko: "보강 명단에서 뺐습니다", en: "Removed from the makeup list" },
  "today.report.sent.title": {
    ko: "학부모에게 발송됨 — {name} 보고서 열기",
    en: "Sent to the parent — open {name}'s report",
  },
  "today.report.written.title": {
    ko: "작성됨 · 아직 발송 전 — {name} 보고서 열기",
    en: "Written · not sent yet — open {name}'s report",
  },
  "today.report.none.title": {
    ko: "아직 작성 전 — {name} 보고서 쓰기",
    en: "Not written yet — write {name}'s report",
  },
  "roster.attitude.none": { ko: "선택 안 함", en: "Not set" },
  "roster.attitude.cycle": {
    ko: "클릭할 때마다 {scale} → 선택 안 함",
    en: "Each click cycles {scale} → Not set",
  },
  "roster.attitude.legacy": {
    ko: "이전 표기 \"{value}\" — 누르면 새 눈금({first})으로 바뀝니다",
    en: "Old wording “{value}” — clicking switches it to the new scale ({first})",
  },

  // ── 출결 모드(/attendance/quick) — 강사가 복도에서 여는 화면 ─────
  "quick.title": { ko: "출결 모드", en: "Attendance mode" },
  "quick.eyebrow": { ko: "출결", en: "Attendance" },
  "quick.header.desc": { ko: "{date} · 내 수업", en: "{date} · my classes" },
  "quick.embed": { ko: "출결 모드 · {date}", en: "Attendance mode · {date}" },
  "quick.holiday.title": { ko: "{name} — 휴원일", en: "{name} — academy closed" },
  "quick.holiday.desc": {
    ko: "이 날은 수업이 없어 출결을 입력하지 않습니다. 학원설정의 휴일 목록을 따릅니다.",
    en: "There are no classes on this day, so attendance is not recorded. This follows the academy's holiday list.",
  },
  "quick.empty.title": { ko: "오늘은 담당 수업이 없습니다", en: "You have no classes today" },
  "quick.empty.desc": {
    ko: "시간표에 오늘 열린 내 수업이 없습니다. 지난 날짜는 월별 출석부에서 고칠 수 있습니다.",
    en: "None of your classes run today. Past dates can be corrected in the monthly attendance sheet.",
  },
  "quick.saveFailed": { ko: "저장하지 못했습니다 — 다시 눌러 주세요", en: "Could not save — please tap again" },
  "quick.blocked": { ko: "{n}명은 이미 입력되어 있어 건너뛰었습니다", en: "Skipped {n} already recorded" },
  // 🔴 숫자를 색·굵기로 감싸야 해서 한 문장으로 못 넣는다 — **조각에 공백까지** 담는다
  //    (`미출결 3명 · 입력 8/9` / `Not marked 3 · Recorded 8/9`).
  "quick.sum.pre": { ko: "미출결 ", en: "Not marked " },
  "quick.sum.mid": { ko: "명 · 입력 ", en: " · Recorded " },
  "quick.readonly": { ko: "읽기 전용", en: "Read only" },
  "quick.card.now": { ko: "지금", en: "Now" },
  "quick.card.recorded": { ko: "입력", en: "recorded" },
  "quick.bulk.title": {
    ko: "아직 입력하지 않은 칸만 전원 출석으로 기록합니다 — 이미 찍은 칸은 건드리지 않습니다",
    en: "Marks everyone present, but only in cells that are still empty — cells already recorded are left alone.",
  },
  "quick.bulk": { ko: "일괄 출결", en: "Mark all present" },
  "quick.sheet.aria": { ko: "{name} 출결 입력", en: "Record attendance for {name}" },
  "quick.sheet.backdrop": { ko: "배경을 눌러 닫기", en: "Tap the background to close" },
  "quick.close": { ko: "닫기", en: "Close" },
  "quick.absent.saved": { ko: "결석으로 기록했습니다", en: "Recorded as absent" },
  "quick.absent.addReason": { ko: "사유 추가(선택)", en: "add a reason (optional)" },
  "quick.late.preview": { ko: "메모로 남을 내용 —", en: "This will be saved as the memo —" },
  // 🔴 어순이 갈린다 — 한국어는 `17:05 등원`, 영어는 `Arrived 17:05`. 조각으로 이으면 한쪽이 어색해진다.
  "quick.late.arrivalAt": { ko: "{time} 등원", en: "Arrived {time}" },
  "quick.late.minusAria": { ko: "등원 시각 5분 앞으로", en: "Arrival time 5 minutes earlier" },
  "quick.late.plusAria": { ko: "등원 시각 5분 뒤로", en: "Arrival time 5 minutes later" },
  "quick.late.minus": { ko: "−5분", en: "−5 min" },
  "quick.late.plus": { ko: "+5분", en: "+5 min" },
  "quick.late.timeAria": { ko: "등원 시각", en: "Arrival time" },
  "quick.late.submit": { ko: "지각 저장", en: "Save as late" },
  "quick.reason.freePh": { ko: "사유 직접 입력", en: "Type a reason" },
  "quick.reason.freeOpen": { ko: "직접 입력", en: "Type it in" },
  "quick.reason.save": { ko: "저장", en: "Save" },

  // ── 월별 출석부(/attendance) — 툴바·안내·허브 ────────────────────
  "att.title": { ko: "출석부", en: "Attendance sheet" },
  "att.teacher.retiredName": { ko: "{name} (퇴직)", en: "{name} (former)" },
  "att.retired": { ko: "퇴직", en: "Former" },
  "att.seat.hint": { ko: "자리 · 여러 반 동시 입실", en: "Seats · several classes at once" },
  "att.moneyNote": {
    ko: "금액·정산액은 담임 반 {n}개 기준 — 교시 담당 {m}개 반은 빠져 있습니다",
    en: "Amounts and pay cover the {n} classes you are homeroom for — the {m} classes you only teach a period in are left out",
  },
  // 반 머리행 끝의 "누가 수업했나"(2026-09-07) — 이름은 데이터, 여기 있는 건 꼬리말과 근거 설명뿐이다.
  "att.group.workerOthers": { ko: "{name} 외 {n}명", en: "{name} +{n}" },
  "att.group.workerReport": {
    ko: "이 달 수업보고서를 쓴 사람입니다.",
    en: "Wrote this month's lesson reports for this class.",
  },
  "att.group.workerAttendance": {
    ko: "이 달 출결을 기록한 사람입니다(수업보고서가 없는 반). 대신 찍어 준 경우가 있어 실제 수업자와 다를 수 있습니다.",
    en: "Recorded this month's attendance (this class has no lesson reports). Someone may have marked it on another teacher's behalf.",
  },
  "att.role.slot": { ko: "교시 담당", en: "Period teacher" },
  "att.since": { ko: "{date}부터 담임", en: "Homeroom since {date}" },
  "att.notice.lock.a": { ko: "출결 수정은 ", en: "Attendance can be edited only for the " },
  "att.notice.lock.b": { ko: "최근 {n}일", en: "last {n} days" },
  "att.notice.lock.c": {
    ko: "(오늘 포함 {date} 이후)만 가능합니다. 그보다 지난 날짜는 잠기며, 수정이 필요하면 관리자에게 요청하세요.",
    en: " ({date} onward, today included). Earlier dates are locked — ask the office if you need a change.",
  },
  "att.notice.scope.a": { ko: "칸 숫자는 ", en: "The number in each cell counts only " },
  "att.notice.scope.b": { ko: "이 선생님이 맡은 교시", en: "the periods this teacher takes" },
  "att.notice.scope.c": {
    ko: "만 셉니다. 같은 반이라도 다른 선생님 교시와 자리(JJ·랩)는 빗금으로만 표시되고 시수·출석률에는 들어가지 않습니다 — 반 전체 숫자는 ",
    en: ". Even in the same class, other teachers' periods and the seat rooms (JJ·Lab) appear only as hatching and are left out of the session and attendance-rate totals — for the whole class, use ",
  },
  "att.notice.scope.d": { ko: "반별 보기", en: "the class view" },
  "att.notice.scope.e": { ko: "에서 봅니다.", en: " instead." },
  "att.notice.empty.teacherPre": { ko: "담당 반에 아직 ", en: "Among your classes, " },
  "att.notice.empty.classPre": { ko: "이 반은 아직 ", en: "In this class, " },
  "att.notice.empty.teacherBold": {
    ko: "선생님 몫으로 잡힌 출결 기록이 없습니다",
    en: "no attendance has been recorded as yours yet",
  },
  "att.notice.empty.classBold": { ko: "출결 기록이 없습니다", en: "no attendance has been recorded yet" },
  "att.notice.empty.c": {
    ko: ". 수업보고서로 자동 표시되는 과목이 아니라서, 셀을 직접 클릭해 찍은 값만 쌓입니다.",
    en: ". This subject is not filled in from lesson reports, so only values you click into the cells are stored.",
  },
  "att.notice.derived.a": { ko: "수업보고서가 있는 등원일은 ", en: "A class day with a lesson report is shown as " },
  "att.notice.derived.b": { ko: ", 보고서가 없는 등원일은 ", en: ", and a class day without one as " },
  "att.notice.derived.c": {
    ko: "으로 자동 표시됩니다. 오늘과 이후 날짜는 아직 판정하지 않습니다. ",
    en: ", automatically. Today and later dates are not judged yet. ",
  },
  "att.notice.derived.d": { ko: "직접 찍은 값이 항상 우선", en: "A value you enter always wins" },
  "att.notice.derived.e": {
    ko: "이며, 셀을 클릭해 언제든 고칠 수 있습니다.",
    en: ", and you can click any cell to change it.",
  },
  "att.nClasses": { ko: "{n}개 반", en: "{n} classes" },
  "att.teacherAll": { ko: "{name} 전체 · {n}개 반", en: "{name} · all {n} classes" },
  "att.teacherFallback": { ko: "강사", en: "Teacher" },
  "att.filter.subject": { ko: "과목", en: "Subject" },
  "att.filter.subjectAria": { ko: "과목 필터", en: "Subject filter" },
  "att.filter.subjectAll": { ko: "전체 과목", en: "All subjects" },
  "att.filter.teacher": { ko: "강사", en: "Teacher" },
  "att.filter.teacherAria": { ko: "강사 필터", en: "Teacher filter" },
  "att.filter.teacherAll": { ko: "전체 강사", en: "All teachers" },
  "att.filter.class": { ko: "반", en: "Class" },
  "att.filter.classAria": { ko: "반 필터", en: "Class filter" },
  "att.filter.classAll": { ko: "전체 반", en: "All classes" },
  "att.filter.classAllMine": { ko: "전체 반(내 반 전부)", en: "All classes (all of mine)" },
  "att.nav.prev": { ko: "이전 달", en: "Previous month" },
  "att.nav.next": { ko: "다음 달", en: "Next month" },
  "att.nav.current": { ko: "눌러서 이번 달로", en: "Click for this month" },
  // 잠금 사유는 period-mode-toggle의 `max-w-[220px] truncate text-xs` 칸에 그대로 선다 — 2026-09-08 v5 글자(14px) 기준
  // Pretendard 실측: 옛 ko 31자 = 315px·옛 en 87자 = 548px라 문장 중간이 끊겼다 → ko 183px·en 199px로 줄였다(title도 같은 문구).
  "att.period.disabledTeacher": {
    ko: "반마다 세션이 달라 달력월로 표시",
    en: "Sessions vary by class; monthly",
  },
  "att.period.disabledNoClass": { ko: "반을 고르면 세션으로 볼 수 있습니다", en: "Pick a class to switch to sessions" },
  "att.period.aria": { ko: "날짜축 전환", en: "Switch date axis" },
  // v5 §10에서 이 축은 `기간: 세션` 드롭다운이 됐다 — 축 이름이 값 앞에 붙는다(옛 세그먼트엔 없던 자리).
  "att.period": { ko: "기간", en: "Period" },
  "att.period.session": { ko: "세션", en: "Session" },
  "att.period.month": { ko: "월", en: "Month" },
  "att.view": { ko: "보기", en: "View" },
  "att.view.class": { ko: "반별", en: "By class" },
  "att.view.teacher": { ko: "강사 전체", en: "By teacher" },
  "att.view.pickTeacher": { ko: "강사를 고르면 전체 보기", en: "Pick a teacher for the all-classes view" },
  "att.sort": { ko: "정렬", en: "Sort" },
  "att.sort.aria": { ko: "정렬 기준", en: "Sort by" },
  "att.scopeChip.title": {
    ko: "칸 숫자는 이 선생님이 맡은 교시만 셉니다. 다른 선생님 교시와 자리(JJ·랩)는 빗금으로만 표시되고 시수·출석률에는 들어가지 않습니다 — 반 전체 숫자는 반별 보기에서 봅니다.",
    en: "The number in each cell counts only the periods this teacher takes. Other teachers' periods and the seat rooms (JJ·Lab) appear only as hatching and are left out of the session and attendance-rate totals — for the whole class, use the class view.",
  },
  "att.scopeChip": { ko: "칸 = 이 선생님 교시", en: "Cells = this teacher's periods" },
  "att.notices": { ko: "안내 {n}", en: "Notes {n}" },
  "att.empty.teacher": {
    ko: "이 강사의 반에 등록된 학생이 없습니다",
    en: "No students are enrolled in this teacher's classes",
  },
  "att.empty.class": { ko: "이 반에 등록된 학생이 없습니다", en: "No students are enrolled in this class" },
  "att.empty.desc": { ko: "학생목록에서 등록 후 다시 확인하세요.", en: "Add them in the student list, then check again." },
  "att.expandAll": { ko: "전체 펼치기", en: "Expand all" },
  "att.collapseAll": { ko: "전체 접기", en: "Collapse all" },
  "att.hideRetired.on": {
    ko: "퇴직한 담임을 강사 목록에서 숨기는 중입니다 — 그 반은 반 목록에 그대로 있습니다",
    en: "Former homeroom teachers are hidden from the teacher list — their classes are still in the class list",
  },
  "att.hideRetired.off": {
    ko: "퇴직한 담임도 강사 목록에 표시합니다",
    en: "Former homeroom teachers are shown in the teacher list",
  },
  "att.hideRetired": { ko: "퇴직자 숨김", en: "Hide former staff" },
  "att.payslip.title": {
    ko: "급여명세서는 전 과목 기준입니다 — 과목 칩으로 좁힌 위 정산액보다 큽니다.",
    en: "The payslip covers every subject — it is larger than the pay figure above, which the subject chip has narrowed.",
  },
  "att.payslip.period": { ko: "급여명세서 {period}", en: "Payslip {period}" },
  "att.payslip": { ko: "급여명세서", en: "Payslip" },
  "att.payslip.allSubjects": { ko: " (전 과목)", en: " (all subjects)" },
  "att.hub.retired": { ko: "(퇴직)", en: "(former)" },
  "att.hub.classesSuffix": { ko: "개 반", en: " classes" },
  "att.hub.todayPre": { ko: " · 오늘 ", en: " · today " },
  "att.hub.todayPost": { ko: "명 입력", en: " recorded" },
  "att.hub.open": { ko: "출석부 열기", en: "Open sheet" },
  "att.hub.title": { ko: "출석부 요약", en: "Attendance summary" },
  "att.hub.today.a": { ko: "{date} — 수업 ", en: "{date} — " },
  "att.hub.today.b": { ko: "개 반 · 출결 입력 ", en: " classes · " },
  "att.hub.today.c": { ko: "명 · 완료 ", en: " recorded · " },
  "att.hub.today.d": { ko: "개 반", en: " done" },
  "att.hub.noClasses": { ko: "{date} — 오늘 예정된 수업이 없습니다", en: "{date} — no classes scheduled today" },
  "att.hub.hint": {
    ko: "강사를 고르면 그 강사의 모든 반이 한 표로 열립니다 · 개별 반은 위 ‘반’ 목록에서 검색",
    en: "Pick a teacher to open all of their classes in one sheet · for a single class, search the ‘Class’ list above",
  },
  "att.hub.noHomeroom": {
    ko: "담임이 배정된 운영 중인 반이 없습니다.",
    en: "There are no active classes with a homeroom teacher.",
  },
  "att.hub.seats": { ko: "랩실 · JJ실", en: "Lab · JJ rooms" },
  "att.hub.seatOpen": { ko: "여러 반이 함께 들어오는 자리", en: "Seats shared by several classes" },
  "att.hub.seatClosed": { ko: "아직 열지 않음", en: "Not open yet" },
  "att.hub.monthly": { ko: "월간", en: "Monthly" },
  "att.hub.day": { ko: "하루", en: "Daily sheet" },
  "att.hub.prep": { ko: "준비 중", en: "Coming soon" },
  "att.search.error": {
    ko: "학생을 찾지 못했습니다 — 잠시 후 다시 시도해 주세요",
    en: "Could not search students — please try again in a moment",
  },
  "att.search.ph": { ko: "학생 이름으로 찾기", en: "Search by student name" },
  "att.search.loading": { ko: "찾는 중…", en: "Searching…" },
  "att.search.where": { ko: "출석부", en: "the attendance sheet" },
  "att.search.unsorted": { ko: "(미분류)", en: "(unclassified)" },
  "att.search.attendDows": { ko: "등원 {dows}", en: "Class days {dows}" },

  // ── 출석부 학생 검색(허브·시트 공용 문구) ───────────────────────
  "att.search.scope.mine": {
    ko: "{month} 수강 중인 담당 반",
    en: "your classes with students enrolled in {month}",
  },
  "att.search.scope.all": { ko: "{month} 수강 중인 반", en: "classes with students enrolled in {month}" },
  "att.search.scope.plain": { ko: "{month} 출석부", en: "the {month} attendance sheet" },
  "att.search.err.classes": {
    ko: "반 목록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
    en: "Could not load the class list — please try again in a moment",
  },
  "att.search.err.students": {
    ko: "학생을 찾는 중 오류가 났습니다 — 잠시 후 다시 시도해 주세요",
    en: "Something went wrong while searching — please try again in a moment",
  },
  "att.search.empty": {
    ko: "‘{query}’ 이름의 학생을 {where}에서 찾지 못했습니다.",
    en: "No student named ‘{query}’ was found in {where}.",
  },
  "att.search.truncated": {
    ko: "앞 {n}건만 표시합니다 — 이름을 더 입력하면 좁혀집니다.",
    en: "Showing the first {n} — type more of the name to narrow it down.",
  },
  "att.search.subjectFallback": { ko: "기타", en: "Other" },

  // ── 월별 출석부 격자(열 머리·도움말·범례·합계) ──────────────────
  "att.col.name": { ko: "이름", en: "Name" },
  "att.col.schoolGrade": { ko: "학교·학년", en: "School · grade" },
  "att.col.billed": { ko: "청구", en: "Billed" },
  "att.col.paid": { ko: "납입", en: "Paid" },
  "att.col.units": { ko: "시수", en: "Sessions" },
  "att.col.rate": { ko: "출석률", en: "Rate" },
  "att.col.billedTitle": {
    ko: "그 학생의 이 달 청구서 총액(다른 과목 포함) — 반별 배분이 아닙니다",
    en: "That student's total invoice for the month (other subjects included) — not a per-class share",
  },
  "att.group.slotTitle": {
    ko: "이 반의 담임은 다른 선생님이고, 교시(시간표 슬롯) 담당으로 배선돼 있어 이 목록에 있습니다.",
    en: "Another teacher is homeroom for this class; it is listed here because this teacher is assigned to a timetable period.",
  },
  "att.group.sinceTitle": {
    ko: "담임을 맡기 전(인수인계·담임 변경 기록 기준) 출결은 이전 담임 몫이라 이 표의 합계에서 뺐습니다 — 기록 자체는 남아 있고, 반별 보기에서 보입니다.",
    en: "Attendance from before this teacher took the class over (per the handover and homeroom-change log) belongs to the previous teacher, so it is left out of these totals — the records themselves remain and show in the class view.",
  },
  "att.group.students": { ko: "{n}명", en: "{n} students" },
  "att.group.units": { ko: "시수 ", en: "Sessions " },
  "att.searchEmpty.where": { ko: "이 달 출석부", en: "this month's sheet" },
  // 강사 미니셸 머리 둘째 줄 — 지금 보는 것이 강사뷰라는 표시(원장 2026-09-14 *"강사뷰 라고 큼직하게"*).
  // 관리자 풀셸 사이드바의 '관리자'와 짝이다(관리자뷰는 한국어 고정이라 사전을 안 거친다).
  "chrome.teacherView": { ko: "강사뷰", en: "Teacher view" },
  "att.legend": { ko: "범례", en: "Legend" },
  "att.legend.classDay": { ko: "등원요일", en: "Class day" },
  /* 🔴 2026-09-14: 범례가 **격자에 실제로 나오는 칠을 전부** 세운다(원장 *"이런 미등원도 범례 추가"* →
     캡처를 더 보내며 *"이런것들"*). 그전엔 등원요일·주말 둘뿐이라 회색(미등원)·빗금(남의 교시)·
     붉은 칸(휴일)은 무슨 뜻인지 화면 어디에도 없었다.
     🔴 `off`에서 '휴일'을 뗀 이유: 같은 날 표 위 '학원 휴일 9/24 …' 안내 줄을 걷어냈고(원장 지시),
        휴일은 주말과 **다른 색**(붉은 계열)이라 한 낱말에 묶으면 둘 중 하나가 거짓이 된다. */
  "att.legend.off": { ko: "주말", en: "Weekend" },
  "att.legend.holiday": { ko: "학원 휴일", en: "Academy holiday" },
  "att.legend.outside": { ko: "미등원", en: "Not enrolled" },
  /* 강사 전체 보기에서만 나오는 빗금 — 값은 없지만 기록은 있다.
     🔴 "다른 선생님 교시"라고 쓰지 말 것 — 빗금은 자리(JJ·랩실) 기록·교시를 안 남긴 옛 기록·담임이 되기 전
        기록에도 나온다. 참인 것은 "이 화면의 몫이 아니다"뿐이다(cell-display.ts `NOT_MINE_MESSAGE` 주석, 적대적 리뷰 2026-09-14). */
  "att.legend.ghost": { ko: "이 화면 몫 아님", en: "Not this sheet's record" },
  /* 합계 줄 오른쪽 끝의 **짧은 조작 안내**(원장 2026-09-14 *"2행은 1행 우측 끝으로 간략하게"*).
     전문은 `att.help.full`이 툴팁으로 나른다. 조각 사이 공백은 사전 값 안에(JSX 줄바꿈은 공백을 지운다).
     ⚠️ 영어 앞 조각을 빈 문자열로 두지 말 것 — `lang-wiring` 가드가 영어값으로 뜻을 묶어서, 빈 문자열끼리
        (`cls.unit.people` 등) '다른 뜻이 영어에서 뭉쳤다'로 걸린다. 그래서 영어는 어순을 바꿔 앞 조각에 낱말을 둔다.
     ⚠️ 한국어 `지각·조퇴·보강·메모는 우클릭`은 `matrix-table.test.tsx`가 잠근 문구다 — 어순을 바꾸지 말 것. */
  "att.help.briefPre": { ko: "총 ", en: "Recorded " },
  "att.help.brief": {
    ko: "회 기록 · 숫자로 입력 · 지각·조퇴·보강·메모는 우클릭",
    en: " in total · type a number · right-click for late·leave·makeup·note",
  },
  "att.help.full": {
    ko: "칸을 고르고 숫자를 치세요(0=결석, 1·1.5·2=출석 시수) · 방향키·Tab·Enter 이동 · Shift로 범위 · Ctrl+C/V · Ctrl+Z · 우하단 손잡이를 끌면 채우기 · 지각·조퇴·보강·메모는 우클릭 (7일 지난 칸도 메모는 고칠 수 있습니다)",
    en: "Select a cell and type a number (0 = absent, 1·1.5·2 = attended units) · Arrows·Tab·Enter to move · Shift for a range · Ctrl+C/V · Ctrl+Z · drag the corner handle to fill · right-click for late·leave·makeup·note (notes stay editable after 7 days)",
  },
  "att.row.thisClass": { ko: "이 반", en: "this class" },
  "att.row.attendDows": { ko: "등원 {dows}", en: "Class days {dows}" },
  "att.row.noTierTitle": {
    ko: "{name} — 단가(수업 티어) 미지정이라 정산액에서 빠져 있습니다. 수강의 티어를 지정하면 계산에 들어갑니다",
    en: "{name} — no rate tier is set, so this student is left out of the pay figure. Set the tier on the enrolment to include them",
  },
  "att.row.noTier": { ko: "단가", en: "No rate" },
  "att.row.tierTitle": { ko: "단가 티어 {tier}", en: "Rate tier {tier}" },
  "att.cell.nPeriods": { ko: "{n}교시 · {breakdown}", en: "{n} periods · {breakdown}" },
  // 🔴 함께 바뀌는 건 **다른 선생님 교시**뿐 — 자리(JJ·랩실) 행은 강사 보기 저장이 안 건드린다(원장 2026-09-12).
  "att.cell.alsoWrites": {
    ko: " · 이 칸을 고치면 다른 선생님 교시 기록 {n}건도 함께 바뀝니다",
    en: " · changing this cell also changes {n} records in other teachers' periods",
  },
  "att.cell.seatKept": {
    ko: " · 자리(JJ·랩실) 기록은 이 칸을 고쳐도 그대로입니다",
    en: " · the JJ and Lab seat records stay as they are when you change this cell",
  },
  "att.cell.outsideRecord": {
    ko: "재원 기간 밖 기록(보강 등)",
    en: "Record from outside the enrolment period (a makeup, for example)",
  },
  "att.cell.outside": { ko: "이 반 재원 기간이 아닙니다", en: "Outside this student's enrolment in this class" },
  "att.cell.sharedDay": {
    ko: "교시가 안 찍힌 기록이라 이 반 전체 몫으로 셉니다(다른 선생님 화면에도 같은 값)",
    en: "No period was stamped on this record, so it counts for the whole class (other teachers see the same value)",
  },
  "att.cell.fromReport": { ko: "수업보고서 자동 판정", en: "Filled in from the lesson report" },
  "att.cell.unmarked": { ko: "미기록", en: "Not recorded" },
  "att.cell.andNPeriods": { ko: " 외 {n}교시", en: " and {n} more periods" },
  "att.cell.ghostCount": { ko: " · 세지 않는 기록 {n}건", en: " · {n} records not counted" },
  "att.cell.unitsAria": { ko: "시수 입력", en: "Enter sessions" },
  "att.cell.fillHandle": { ko: "드래그하여 옆 칸에 같은 값 채우기", en: "Drag to fill the same value across" },
  "att.cell.ghostPrefix": { ko: "이 선생님 몫으로 세지 않는 기록 · ", en: "Records not counted for this teacher · " },
  "att.totals.search": { ko: "검색 합계", en: "Search total" },
  "att.totals.all": { ko: "합계", en: "Total" },
  "att.totals.searching": { ko: "검색 중 — 전체 아님", en: "Searching — not the full set" },
  "att.totals.classes": { ko: "개 반", en: " classes" },
  "att.totals.units": { ko: "시수 ", en: "Sessions " },
  "att.totals.billed": { ko: "청구 {amount}", en: "Billed {amount}" },
  "att.totals.paidPre": { ko: " · 납입 ", en: " · paid " },
  "att.totals.basis": { ko: "명 기준)", en: " students)" },
  "att.totals.slotTitle": {
    ko: "교시(시간표 슬롯) 담당으로 들어온 반입니다. 급여 배분은 아직 담임 축이라 이 반의 청구·정산액은 담임 선생님 쪽에 잡혀 있습니다.",
    en: "This class is here because the teacher takes a timetable period in it. Pay is still split by homeroom, so its billing and pay sit with the homeroom teacher.",
  },
  "att.totals.sharedTitle": {
    ko: "다른 과목·강사와 청구서를 함께 쓰는 학생입니다. 이 금액은 강사 몫이 아니라 학생 총액이라 그대로 급여 기준으로 쓰면 안 됩니다.",
    en: "These students share an invoice with other subjects or teachers. The figure is the student's total, not this teacher's share, so it must not be used as a pay basis as it stands.",
  },
  "att.totals.shared": { ko: "공유 {n}", en: "Shared {n}" },
  "att.totals.sharedIncluded": { ko: "명 포함", en: " included" },
  "att.totals.pay": { ko: "정산액 {amount}", en: "Pay {amount}" },
  "att.totals.unitsPre": { ko: "(시수 ", en: "(sessions " },
  "att.totals.formula": { ko: " · 단가×시수×0.911×비율)", en: " · rate × sessions × 0.911 × share)" },
  "att.totals.missingTierTitle": {
    ko: "단가(수업 티어)가 지정되지 않아 정산액에서 빠진 학생입니다: {names}",
    en: "Students left out of the pay figure because no rate tier is set: {names}",
  },
  "att.totals.missingTier": {
    ko: "단가 미지정 {n}명 · {units}시수 제외",
    en: "No rate tier for {n} · {units} sessions excluded",
  },
  "att.totals.missingPriceTitle": {
    ko: "단가표(salary_tiers)에 없는 티어입니다: {tiers}",
    en: "Tiers missing from the rate table: {tiers}",
  },
  "att.totals.missingPrice": { ko: "단가표 미등록 티어 {n}건", en: "{n} tiers not in the rate table" },
  "att.totals.missingTierPlain": { ko: "단가 미지정: {names}", en: "No rate tier: {names}" },
  "att.totals.payHold": {
    ko: "정산액 보류 — 단가·비율이 지정된 학생이 없습니다",
    en: "Pay on hold — no student has a rate or share set",
  },
  "att.totals.noTerms": {
    ko: "정산액 — 회차 확정이 없어 반별 배분을 낼 수 없습니다(수납관리 > 회차)",
    en: "Pay — no confirmed sessions, so a per-class split cannot be produced (Billing > Sessions)",
  },
  "att.totals.noRate": {
    ko: "정산액 — 배분율 미설정(수납관리 > 강사 정산)",
    en: "Pay — no share set (Billing > Teacher pay)",
  },
  "att.totals.rateNote": {
    ko: "배분율 {rate}% · 정산액은 수납관리 > 강사 정산에서",
    en: "Share {rate}% · the pay figure lives in Billing > Teacher pay",
  },
  "att.stat.enrolled": { ko: "등록", en: "On roll" },
  "att.stat.people": { ko: "명", en: "students" },
  "att.stat.rate": { ko: "출석률", en: "Rate" },
  "att.stat.noRecord": { ko: "기록 없음", en: "no records" },
  "att.stat.absent": { ko: "결석", en: "Absences" },
  "att.stat.late": { ko: "지각", en: "Late" },
  "att.stat.times": { ko: "회", en: "times" },

  // 학생 행 뱃지 툴팁(신입·퇴원·반이동) — 자리 출석부·MCS도 같은 함수를 쓴다.
  "att.badge.new": { ko: "{date} 첫 수업", en: "First class {date}" },
  "att.badge.left": { ko: "{date} 퇴원", en: "Left {date}" },
  "att.badge.transferIn": {
    ko: "반이동: {from} → {to} ({date}부터)",
    en: "Moved class: {from} → {to} (from {date})",
  },
  "att.badge.transferOut": {
    ko: "반이동: {from} → {to} ({date}까지)",
    en: "Moved class: {from} → {to} (through {date})",
  },

  // ── 출석부 칸 팝오버(우클릭)·격자 안내·검색 칩 ─────────────────
  "att.pop.aria": { ko: "출결 상세 입력", en: "Attendance details" },
  "att.pop.noRecord": {
    ko: "기록이 없는 날이라 메모만 남길 수는 없습니다 — 관리자에게 요청하세요",
    en: "There is no record on this day, so a note alone cannot be saved — ask the office",
  },
  "att.pop.note": { ko: "메모 · {note}", en: "Note · {note}" },
  "att.pop.noteAnytime": { ko: "메모는 기간과 무관하게 고칠 수 있습니다", en: "Notes stay editable whatever the date" },
  "att.pop.notePh": { ko: "메모(사유)", en: "Note (reason)" },
  "att.pop.saving": { ko: "저장 중…", en: "Saving…" },
  "att.pop.saveNote": { ko: "메모 저장", en: "Save note" },
  "att.pop.unitsPh": { ko: "시수(기본 1)", en: "Sessions (default 1)" },
  // 수학 자동 시수(원장 2026-09-11) — 빈 칸으로 **처음** 찍으면 수업 길이 값이 들어간다(auto-units.ts).
  "att.pop.unitsPhAuto": { ko: "시수(기본 {n} · 수업 길이)", en: "Sessions (default {n}, class length)" },
  "att.pop.unitsAria": { ko: "시수", en: "Sessions" },
  "att.pop.unitsTitle": {
    ko: "정규 수업 1회 = 1. 보강 연장 1.5·2, 부분 출석 0.5 등",
    en: "One regular class = 1. Use 1.5 or 2 for extended makeups, 0.5 for a partial attendance, and so on",
  },
  "att.pop.pickFirst": { ko: "상태를 먼저 선택하세요", en: "Pick a status first" },
  "att.pop.save": { ko: "저장", en: "Save" },
  "att.pop.clear": { ko: "지우기", en: "Clear" },
  // 🔴 {n} = 다른 선생님 교시 기록만 — 자리(JJ·랩실)는 강사 보기 저장이 안 건드려서 세지도 적지도 않는다(원장 2026-09-12).
  "att.pop.sharedWarn.a": {
    ko: "고치면 같은 날 다른 선생님 교시 기록 {n}건도 함께 바뀝니다. 지우기는 여기서 못 합니다 — ",
    en: "Changing this also changes {n} records in other teachers' periods that day. Clearing is not possible here — use ",
  },
  "att.pop.sharedWarn.b": { ko: "반별 보기에서 지우세요", en: "the class view to clear it" },
  "att.grid.sharedBlock": {
    ko: "이 칸엔 다른 선생님 교시 기록 {n}건이 함께 있어 여기서 지우면 그것까지 지워집니다 — 반별 보기에서 지우세요",
    en: "This cell also holds {n} records from other teachers' periods, so clearing here would clear those too — clear it in the class view",
  },
  "att.grid.sharedNotice": {
    ko: "같은 날 다른 선생님 교시 기록 {n}건도 함께 바뀝니다",
    en: "{n} records in other teachers' periods that day change too",
  },
  "att.grid.skip.locked": { ko: "{n}칸은 수정 기간(7일)이 지나", en: "{n} cells are past the 7-day edit window" },
  "att.grid.skip.notMine": { ko: "{n}칸은 선생님 교시가 없어", en: "{n} cells have no period for this teacher" },
  "att.grid.skip.mixed": {
    ko: "{n}칸은 다른 교시 기록이 함께 있어(반별 보기에서 지우세요)",
    en: "{n} cells also hold other periods' records (clear them in the class view)",
  },
  "att.grid.skip.tail": { ko: "{list} 건너뛰었습니다", en: "{list} — skipped" },
  "att.grid.clear.skipped": {
    ko: "{n}칸은 수정 기간이 지났거나 담당 반·선생님 교시가 아니어서 건너뛰었습니다",
    en: "{n} cells were skipped — past the edit window, or not this teacher's class or period",
  },
  "att.grid.clear.mixed": {
    ko: "{n}칸은 다른 교시 기록이 함께 있어 안 지웠습니다 — 반별 보기에서 지우세요",
    en: "{n} cells also hold other periods' records and were left alone — clear them in the class view",
  },
  "att.grid.clear.shared": {
    ko: "{n}칸은 같은 날 다른 선생님 교시 기록도 함께 바뀌었습니다",
    en: "{n} cells also changed records in other teachers' periods that day",
  },
  "att.grid.clear.sharedMaybe": {
    ko: "{n}칸은 같은 날 다른 선생님 교시 기록도 함께 바뀌었을 수 있습니다",
    en: "{n} cells may also have changed records in other teachers' periods that day",
  },
  "att.search.totalsNote": { ko: "숫자도 검색 기준", en: "totals follow the search" },
  "att.search.count": { ko: "검색 {n}명", en: "{n} found" },
  "att.search.clear": { ko: "검색 지우기", en: "Clear search" },

  "att.search.none": {
    ko: "‘{query}’과 맞는 학생이 {where}에 없습니다 — 검색어를 지우면 전체가 다시 보입니다.",
    en: "No student matches ‘{query}’ in {where} — clear the search to see everyone again.",
  },

  // ── 학생목록(/students) — 머리·툴바 필터·표 ─────────────────────
  "stu.title": { ko: "원생목록", en: "Student list" },
  "stu.eyebrow": { ko: "원생 관리", en: "Student management" },
  "stu.desc": { ko: "재원 {n}명 · {basis}", en: "{n} enrolled · {basis}" },
  "stu.basis.mine": { ko: "담당 과목 기준", en: "your subjects" },
  "stu.basis.settings": { ko: "학원설정 과목 기준", en: "the academy's subjects" },
  "stu.excel": { ko: "엑셀 내보내기", en: "Export to Excel" },
  // v5 §9·§10: 내보내기·가져오기가 텍스트 더보기 메뉴 하나로 묶였다 — 축 이름과 가져오기 항목이 새로 필요하다.
  "stu.excelAxis": { ko: "엑셀", en: "Excel" },
  "stu.excelImport": { ko: "엑셀 가져오기", en: "Import from Excel" },
  "stu.count.pre": { ko: "결과 ", en: "Found " },
  "stu.count.post": { ko: "명", en: " students" },
  "stu.count.pages": { ko: "{page}/{total} 페이지", en: "page {page} of {total}" },
  "stu.count.q": { ko: "“{q}” 검색", en: "search “{q}”" },
  "stu.empty.title": { ko: "결과 없음", en: "No results" },
  "stu.empty.desc": { ko: "검색어/필터를 조정해보세요.", en: "Try adjusting the search or the filters." },
  "stu.col.student": { ko: "학생", en: "Student" },
  "stu.col.status": { ko: "상태", en: "Status" },
  "stu.col.subjects": { ko: "수강 과목", en: "Subjects" },
  "stu.col.teacher": { ko: "담당 강사", en: "Assigned teacher" },
  "stu.col.parentPhone": { ko: "학부모 연락처", en: "Parent contact" },
  "stu.rowAria": { ko: "{name} 학생 정보", en: "{name} — student profile" },
  "stu.filter.all": { ko: "전체", en: "All" },
  // v5 학생목록의 토글 하나(§10) — 옛 필터바에서 살아남은 유일한 칩이라 사전에 없던 낱말이다.
  "stu.filter.noEnr": { ko: "미수강 제외", en: "Hide unenrolled" },
  "stu.filter.status": { ko: "상태", en: "Status" },
  "stu.filter.statusAria": { ko: "상태 필터", en: "Status filter" },
  "stu.filter.status.enrolled": { ko: "재원", en: "Enrolled" },
  "stu.filter.status.consulted": { ko: "예비·상담", en: "Prospect · consulted" },
  "stu.filter.status.onHold": { ko: "휴원", en: "On hold" },
  "stu.filter.status.withdrawn": { ko: "퇴원", en: "Withdrawn" },
  "stu.filter.subject": { ko: "과목", en: "Subject" },
  "stu.filter.subjectAria": { ko: "과목 필터", en: "Subject filter" },
  "stu.filter.grade": { ko: "학년", en: "Grade" },
  "stu.filter.gradeAria": { ko: "학년 필터", en: "Grade filter" },
  "stu.filter.teacher": { ko: "담임", en: "Homeroom" },
  "stu.filter.teacherAria": { ko: "담임 필터", en: "Homeroom filter" },
  "stu.filter.field": { ko: "검색 필드", en: "Search in" },
  "stu.filter.field.all": { ko: "전체 필드", en: "All fields" },
  "stu.filter.field.name": { ko: "이름", en: "Name" },
  "stu.filter.field.school": { ko: "학교", en: "School" },
  "stu.filter.field.phone": { ko: "전화번호", en: "Phone" },
  "stu.filter.field.address": { ko: "주소", en: "Address" },
  "stu.filter.field.email": { ko: "이메일", en: "Email" },
  "stu.filter.field.memo": { ko: "메모", en: "Memo" },
  "stu.filter.sort": { ko: "정렬", en: "Sort" },
  "stu.filter.sortAria": { ko: "정렬 기준", en: "Sort by" },
  "stu.filter.sort.grade": { ko: "학년순", en: "By grade" },
  "stu.filter.sort.name": { ko: "이름순", en: "By name" },
  "stu.filter.sort.recent": { ko: "등록일순", en: "By date added" },
  "stu.filter.noEnrollment": { ko: "미수강 제외", en: "Hide unenrolled" },
  "stu.filter.searchPh": { ko: "이름·학교·연락처·메모", en: "Name, school, phone or memo" },
  // 운영실 KPI ↗가 넘긴 학생 집합 칩(원장 2026-09-11) — 눌러 푼다. 프로그램 이름(EiE·인재원 영어)은 번역하지 않는다.
  "stu.filter.program": { ko: "프로그램", en: "Program" },
  "stu.filter.first": { ko: "첫 수업: {m}월 {d}일", en: "First class: {m}/{d}" },

  // ── 이력서 종이 서식(/me) — 🔴 화면만 언어를 타고 **인쇄물은 언제나 한국어**다 ────
  "res.title.roster": { ko: "직원 명부", en: "Staff register" },
  "res.title.resume": { ko: "이력서", en: "Resume" },
  "res.sec.personal": { ko: "1. 인적사항", en: "1. Personal details" },
  "res.sec.education": { ko: "2. 학력사항", en: "2. Education" },
  "res.sec.career": { ko: "3. 경력사항", en: "3. Work history" },
  "res.sec.cert": { ko: "4. 자격증 및 외국어 능력", en: "4. Certificates & languages" },
  "res.sec.contract": { ko: "5. 계약사항", en: "5. Employment terms" },
  "res.sec.docs": { ko: "6. 제출서류 확인", en: "6. Documents received" },
  "res.f.name": { ko: "성명", en: "Full name" },
  "res.f.nameEn": { ko: "영문", en: "In English" },
  "res.f.photo": { ko: "증명사진", en: "ID photo" },
  "res.f.rrn": { ko: "주민등록번호", en: "Resident reg. no." },
  "res.f.address": { ko: "주소", en: "Address" },
  "res.f.phone": { ko: "전화번호", en: "Phone" },
  "res.f.eduPeriod": { ko: "재학 기간", en: "Dates attended" },
  "res.f.school": { ko: "학교명", en: "School name" },
  "res.f.major": { ko: "전공", en: "Major" },
  "res.f.gpa": { ko: "학점", en: "GPA" },
  "res.f.location": { ko: "소재지", en: "Location" },
  "res.f.employer": { ko: "직장명", en: "Employer" },
  "res.f.workPeriod": { ko: "근무 기간", en: "Dates employed" },
  "res.f.duties": { ko: "담당 업무", en: "Duties" },
  "res.f.salary": { ko: "월급여", en: "Monthly pay" },
  "res.f.leaveReason": { ko: "퇴직 사유", en: "Reason for leaving" },
  "res.f.cert": { ko: "자격증 취득사항", en: "Certificate" },
  "res.f.certDate": { ko: "취득년월일", en: "Date awarded" },
  "res.f.issuer": { ko: "발행처", en: "Issued by" },
  "res.f.lang": { ko: "외국어 능력", en: "Foreign language" },
  "res.f.testDate": { ko: "시험일", en: "Test date" },
  "res.f.score": { ko: "점수/등급", en: "Score / grade" },
  "res.f.company": { ko: "회사 구분", en: "Company" },
  "res.f.division": { ko: "근무부서", en: "Department" },
  "res.f.jobTitle": { ko: "직급", en: "Job title" },
  "res.f.manager": { ko: "처리담당자", en: "Processed by" },
  "res.f.workDays": { ko: "근무요일", en: "Working days" },
  "res.f.pay": { ko: "급여 계약", en: "Pay" },
  "res.f.empType": { ko: "근무형태", en: "Employment type" },
  "res.f.account": { ko: "계좌번호", en: "Bank account" },
  "res.f.startDate": { ko: "입사일", en: "Start date" },
  "res.f.docs": { ko: "서류 확인", en: "Document check" },
  "res.pay.monthly": { ko: "(월급)", en: "(monthly)" },
  "res.pay.annual": { ko: "(연봉)", en: "(annual)" },
  "res.bankEmpty": { ko: "(은행)", en: "(bank)" },
  "res.ph.nameEn": { ko: "영문 이름", en: "Name in English" },
  "res.ph.certName": { ko: "자격증명", en: "Certificate name" },
  "res.ph.lang": { ko: "외국어 (시험명)", en: "Language (test name)" },
  "res.ph.select": { ko: "선택", en: "Select" },
  "res.ph.divisionFirst": { ko: "근무부서를 먼저 고르세요", en: "Choose a department first" },
  "res.ph.salaryMonthly": { ko: "예: 2,800,000원", en: "e.g. 2,800,000 KRW" },
  "res.ph.salaryAnnual": { ko: "예: 40,000,000원", en: "e.g. 40,000,000 KRW" },
  "res.ph.bank": { ko: "은행명", en: "Bank" },
  "res.edu.ph.hs": { ko: "고등학교", en: "High school" },
  "res.edu.ph.uni": { ko: "대학교", en: "University" },
  "res.edu.ph.grad": { ko: "대학원", en: "Graduate school" },
  "res.opt.existing": { ko: "{v} (기존)", en: "{v} (current)" },
  "res.subj.auto": {
    ko: "담당 과목은 부서에 따라 자동 지정됩니다",
    en: "Subjects are set automatically from the department",
  },
  "res.subj.list": { ko: "담당 과목 {list} (부서 기준 자동)", en: "Subjects: {list} (from the department)" },
  "res.subj.none": { ko: "담당 과목 없음 (교과 부서가 아님)", en: "No subjects (not a teaching department)" },
  "res.photo.alt": { ko: "증명사진 {n}", en: "ID photo {n}" },
  "res.photo.attached": { ko: "사진 첨부됨", en: "Photo attached" },
  "res.photo.slot": { ko: "사진 {n}", en: "Photo {n}" },
  "res.photo.prev": { ko: "이전 사진", en: "Previous photo" },
  "res.photo.next": { ko: "다음 사진", en: "Next photo" },
  "res.photo.show": { ko: "사진 {n} 보기", en: "Show photo {n}" },
  "res.photo.uploading": { ko: "올리는 중…", en: "Uploading…" },
  "res.photo.change": { ko: "변경", en: "Replace" },
  "res.photo.attach": { ko: "첨부", en: "Attach" },
  "res.photo.ticketFail": { ko: "업로드 티켓 발급 실패", en: "Could not get an upload ticket" },
  "res.photo.uploadFail": { ko: "사진 업로드에 실패했습니다", en: "Photo upload failed" },
  "res.rows.add": { ko: "{label} 행 추가", en: "Add a {label} row" },
  "res.rows.removeLast": { ko: "{label} 마지막 행 삭제", en: "Remove the last {label} row" },
  "res.rows.education": { ko: "학력", en: "education" },
  "res.rows.career": { ko: "경력", en: "career" },
  "res.rows.cert": { ko: "자격증", en: "certificate" },
  "res.rows.language": { ko: "외국어", en: "language" },
  "res.hint.editing": {
    ko: "칸을 클릭해 바로 입력하세요 — 저장해야 반영됩니다.",
    en: "Click a box and type — nothing is kept until you press Save.",
  },
  "res.hint.view": {
    ko: "종이 서식 그대로 — 인쇄하거나 수정할 수 있습니다.",
    en: "The paper form as it is — you can print it or edit it.",
  },
  "res.edit": { ko: "수정", en: "Edit" },
  "res.print": { ko: "인쇄", en: "Print" },
  "res.delete": { ko: "삭제", en: "Delete" },
  "res.save": { ko: "저장", en: "Save" },
  "res.cancel": { ko: "취소", en: "Cancel" },
  "res.del.askNamed": { ko: "{name} 이력서 삭제?", en: "Delete {name}’s resume?" },
  "res.del.ask": { ko: "이 이력서 삭제?", en: "Delete this resume?" },
  "res.del.fail": {
    ko: "삭제하지 못했습니다 — 연결을 확인하고 다시 눌러 주세요",
    en: "Could not delete — check the connection and try again",
  },
  "res.sr.selected": { ko: " 선택됨", en: " selected" },
  "res.sr.notSelected": { ko: " 선택 안 함", en: " not selected" },
  "res.sr.done": { ko: " 완료", en: " checked" },
  "res.sr.notDone": { ko: " 미완료", en: " not checked" },
  "res.sync.name.a": { ko: "바꾸면 ", en: "Changing this also updates the " },
  "res.sync.name.b": { ko: "앱 표시 이름", en: "display name" },
  "res.sync.name.c": { ko: "도 함께 바뀝니다", en: " used across the app." },
  "res.sync.email.a": { ko: "이 주소를 바꾸면 ", en: "Changing this address also changes the " },
  "res.sync.email.b": { ko: "로그인 아이디도 함께", en: "login ID" },
  "res.sync.email.c": { ko: " 바뀝니다", en: " they sign in with." },
  "res.acct.register": { ko: "저장하면서 직원 계정도 함께 등록", en: "Also create a staff login when saving" },
  "res.acct.role": { ko: "시스템 역할", en: "System role" },
  "res.acct.rolePh": { ko: "역할 선택", en: "Choose a role" },
  "res.acct.roleAria": { ko: "직원 계정 역할", en: "Role for the staff login" },
  "res.acct.note.a": {
    ko: "인적사항의 E-mail로 로그인 계정을 만들고, 초기 비밀번호는 ",
    en: "A login is created from the E-mail in Personal details, and the initial password is ",
  },
  "res.acct.note.b": {
    ko: " — 본인이 로그인 후 변경합니다. 같은 이메일 직원이 이미 있으면 새로 만들지 않고 그 직원과 이력서를 연결합니다. 역할은 기본 ‘강사’ — 다르면 위에서 바꿔 주세요.",
    en: " — they change it after signing in. If a staff member with the same e-mail already exists, no new login is created and the resume is linked to that person instead. The role defaults to ‘Teacher’ — change it above if that is wrong.",
  },

  // ── 원스크린(/onescreen) — 상단 바·격자·출결 알약·발송 현황 ────────────
  "os.date.prev": { ko: "이전 날짜", en: "Previous date" },
  "os.date.pick": { ko: "날짜 선택", en: "Pick a date" },
  "os.date.next": { ko: "다음 날짜", en: "Next date" },
  "os.close.today": { ko: "수업 마감", en: "Today's wrap-up" },
  "os.close.past": { ko: "지난 마감", en: "Past wrap-up" },
  "os.today": { ko: "오늘", en: "Today" },
  "os.class.all": { ko: "전체", en: "All" },
  "os.class.delegated": { ko: "위임", en: "Covering" },
  "os.class.delegatedTitle": {
    ko: "결근한 선생님 대신 이 기간에만 맡은 반입니다",
    en: "A class you cover for an absent teacher, for this period only",
  },
  "os.class.ownerNamed": { ko: "{name} 선생님 반", en: "{name}'s class" },
  "os.class.ownerUnknown": { ko: "다른 선생님 반", en: "another teacher's class" },
  "os.class.borrowed": { ko: "{name} — {owner}, 위임받음", en: "{name} — {owner}, covered by you" },
  "os.class.lent": { ko: "{name} — {to} 선생님에게 위임 중", en: "{name} — covered by {to}" },
  "os.class.borrowedHint": {
    ko: "{owner} — 이 기간에만 대신 맡은 위임 반입니다",
    en: "{owner} — you are covering this class for this period only",
  },
  "os.class.lentHint": {
    ko: "이 날짜에는 {to} 선생님이 대신 맡습니다 — 직접 쓰실 수도 있지만 둘이 각자 쓰면 나중에 쓴 쪽이 남습니다",
    en: "{to} covers this class on this date — you may still write it, but if you both do, the later one wins",
  },
  "os.class.attendOnly": { ko: "출결만", en: "Attendance only" },
  "os.class.lentChip": { ko: "위임중", en: "Covered" },
  // v5 §10에서 세그먼트가 `축: 값` 드롭다운이 됐다 — 축 이름과 항목 힌트가 새로 필요하다.
  "os.write.axis": { ko: "작성", en: "Written" },
  "os.ment.axis": { ko: "멘트", en: "Message" },
  "os.ment.aHint": { ko: "한 문단", en: "One paragraph" },
  "os.ment.bHint": { ko: "수업 내용 + 태도", en: "Lesson + attitude" },
  "os.write.all": { ko: "전체", en: "All" },
  "os.write.written": { ko: "작성", en: "Written" },
  "os.write.unwritten": { ko: "미작성", en: "Not written" },
  "os.write.title": {
    ko: "학부모 문구 기준 — 모든 행에 문구가 있거나 이미 발송됐으면 '작성', 한 행이라도 비어 있으면 '미작성'입니다(결석 행은 발송 대상이 아니라 판정에서 제외). 필터를 켠 뒤 입력해도 카드·행이 사라지지 않으며, 같은 버튼을 다시 누르면 목록을 정리합니다.",
    en: "Judged by the parent message — 'Written' when every row has one (or was already sent), 'Not written' when any row is empty (absent rows are not sent, so they are left out). Typing after you switch the filter on does not make cards or rows disappear; press the same button again to tidy the list.",
  },
  "os.stat.students": { ko: "학생", en: "Students" },
  "os.stat.progress": { ko: "진도", en: "Progress" },
  "os.stat.test": { ko: "테스트", en: "Test" },
  "os.stat.done": { ko: "마감", en: "Wrapped" },
  "os.ment.academy": { ko: "학원 기본({mode})", en: "Academy default ({mode})" },
  "os.ment.a": { ko: "단일 A", en: "One block (A)" },
  "os.ment.b": { ko: "2문단 B", en: "Two blocks (B)" },
  "os.ment.title": {
    ko: "학부모 멘트 문단 구성(내 계정) — A는 한 문단, B는 '수업 내용'과 '태도·특이사항' 2문단. 아래 보고서 입력칸과 자동 작성 결과가 함께 바뀝니다.",
    en: "How the parent message is laid out (your account) — A is one block, B splits it into 'what we covered' and 'attitude & notes'. The report boxes below and auto-writing follow this.",
  },
  "os.fontSize": { ko: "글씨 크기", en: "Text size" },
  "os.fontSize.title": {
    ko: "아래 목록·표의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다",
    en: "Text size for the list and table below (your account) — it opens the same size on any computer",
  },
  "os.quick.title": {
    ko: "오늘 내 수업의 출결만 터치로 빠르게 입력합니다",
    en: "Tap through attendance for today's classes only",
  },
  "os.quick": { ko: "출결 모드", en: "Attendance mode" },
  // v5 §10: 면 전환이 `보기: 카드` 드롭다운이 됐다 — 축 이름이 새로 필요하다.
  "os.face.axis": { ko: "보기", en: "View" },
  "os.face.card": { ko: "카드", en: "Cards" },
  "os.face.table": { ko: "표", en: "Table" },
  "os.face.sendStatus": { ko: "발송 현황", en: "Send status" },
  "os.face.monthly": { ko: "월간 발송", en: "Monthly sends" },
  "os.face.notice": { ko: "공지", en: "Notice" },
  "os.bar.shown": { ko: "표시", en: "Shown" },
  "os.bar.sendable": { ko: "발송가능", en: "Ready to send" },
  "os.bar.noMent": { ko: "(멘트 미작성 {n})", en: "({n} with no message)" },
  "os.bar.selected": { ko: "선택", en: "Selected" },
  "os.bar.selectedSendable": { ko: "(발송가능 {n})", en: "({n} ready)" },
  "os.bar.keyHint": {
    ko: "점수·교재 칸은 Enter·↑↓로 위·아래 이동",
    en: "In score and book boxes, Enter and ↑↓ move up and down",
  },
  "os.prev.face": { ko: "이전 회차 참고", en: "Last session" },
  "os.prev.title": {
    ko: "선택(없으면 표시 전체) 행의 빈 칸을 이전 회차 값으로 채웁니다 — 진도·태도·과제·오늘 과제만, 특이사항 제외. 멘트는 확인을 받은 뒤에만. 이미 입력한 칸은 건드리지 않습니다",
    en: "Fills empty boxes in the selected rows (all shown rows if none are selected) with last session's values — progress, attitude, homework and today's homework only; notes are left out. The parent message is only filled after you confirm. Boxes you already typed in are untouched.",
  },
  "os.prev.pick": { ko: "선택 {n} 이전값 가져오기", en: "Copy last session into {n}" },
  "os.prev.allRows": { ko: "이전값 일괄 가져오기", en: "Copy last session into all" },
  "os.attach.pick": { ko: "선택 {n} 첨부", en: "Attach to {n}" },
  "os.notice.title": {
    ko: "선택(없으면 표시 전체) 학생 학부모에게 공지 발송 — 진도와 무관",
    en: "Sends a notice to the parents of the selected students (all shown if none are selected) — unrelated to progress",
  },
  "os.notice.pick": { ko: "선택 {n}명 공지", en: "Notice to {n}" },
  "os.notice.whole": { ko: "반 전체 공지", en: "Notice to the whole class" },
  "os.gen.nonePreserved": {
    ko: "자동작성할 행이 없습니다 — 멘트가 있는 {n}건은 그대로 둡니다(다시 만들려면 행별 '자동작성')",
    en: "No rows to auto-write — the {n} rows that already have a message are left alone (use the per-row 'Auto-write' to redo one)",
  },
  "os.gen.noneProgress": {
    ko: "자동작성할 행이 없습니다 — 오늘 진도를 먼저 입력하세요",
    en: "No rows to auto-write — enter today's progress first",
  },
  "os.gen.some": {
    ko: "멘트가 비어 있는 {n}건만 생성합니다 — 이미 멘트가 있는 {kept}건은 건드리지 않습니다",
    en: "Writes only the {n} rows with an empty message — the {kept} that already have one are untouched",
  },
  "os.gen.count": { ko: "{n}건의 멘트를 생성합니다", en: "Writes {n} messages" },
  "os.gen.busy": { ko: "자동작성 중…", en: "Auto-writing…" },
  "os.gen.pick": { ko: "{pick} 자동작성", en: "Auto-write {pick}" },
  "os.gen.all": { ko: "전체 자동작성 {n}", en: "Auto-write all {n}" },
  "os.save.none": {
    ko: "고른 행 중 저장할 수 있는 행이 없습니다 — 오늘 진도가 비었거나 이미 발송된 행입니다",
    en: "None of the chosen rows can be saved — today's progress is empty or the row was already sent",
  },
  "os.save.pick": { ko: "{pick} 저장", en: "Save {pick}" },
  "os.save.all": { ko: "일괄 저장", en: "Save all" },
  "os.send.none": {
    ko: "발송할 수 있는 행이 없습니다 — 진도·멘트 미작성, 결석, 이미 발송된 행입니다",
    en: "No row can be sent — progress or message is missing, the student was absent, or it was already sent",
  },
  "os.send.pick": { ko: "{pick} 발송", en: "Send {pick}" },
  "os.send.all": { ko: "ClassNote 일괄 발송", en: "Send all to ClassNote" },
  "os.bulk.pick": { ko: "선택 {n}", en: "{n} selected" },
  "os.bulk.pickOf": { ko: "선택 {n} 중 {m}", en: "{m} of {n} selected" },
  "os.grid.empty": { ko: "표시할 학생이 없습니다", en: "No students to show" },
  "os.order.hint": { ko: "↑↓로 학생 순서를 바꾼 뒤 저장하세요", en: "Reorder students with ↑↓, then save" },
  "os.order.cancel": { ko: "취소", en: "Cancel" },
  "os.order.saving": { ko: "저장 중…", en: "Saving…" },
  "os.order.save": { ko: "순서 저장", en: "Save order" },
  "os.order.title": {
    ko: "학생 표시 순서 변경 — 이 반에 저장(좌석·채점지 순서). 다음 작성에도 유지",
    en: "Change the order students appear in — saved on this class (seating and marking order) and kept next time",
  },
  "os.order.needClass": { ko: "반을 하나 선택하면 학생 순서를 바꿀 수 있습니다", en: "Pick one class to reorder its students" },
  "os.order": { ko: "순서", en: "Order" },
  "os.grid.selectAll": { ko: "표시 행 전체 선택", en: "Select every shown row" },
  "os.col.student": { ko: "학생 · 반", en: "Student · class" },
  "os.col.units.title": {
    ko: "수업타임(시수) — 기본 1. 출석부에 그대로 들어갑니다(학부모 보고서엔 미표시)",
    en: "Class units — 1 by default. Goes straight into the attendance sheet (not shown to parents)",
  },
  "os.col.units": { ko: "타임", en: "Units" },
  "os.col.progress": { ko: "진도(오늘)", en: "Progress (today)" },
  "os.col.daily": { ko: "일일", en: "Daily" },
  "os.col.check": { ko: "확인", en: "Check" },
  "os.col.attitude": { ko: "태도", en: "Attitude" },
  "os.col.homework": { ko: "과제 수행률", en: "Homework done" },
  "os.col.book": { ko: "교재명 · 보강", en: "Book · makeup" },
  "os.col.ment": { ko: "학부모 문구", en: "Parent message" },
  "os.col.send": { ko: "발송 · 편집", en: "Send · edit" },
  "os.row.up": { ko: "{name} 위로", en: "Move {name} up" },
  "os.row.down": { ko: "{name} 아래로", en: "Move {name} down" },
  "os.chip.prog": { ko: "진도", en: "Progress" },
  "os.chip.prog.title": { ko: "오늘 진도 입력 여부", en: "Whether today's progress is filled in" },
  "os.chip.test": { ko: "테스트", en: "Test" },
  "os.chip.test.title": { ko: "테스트 점수 입력 여부", en: "Whether a test score is filled in" },
  "os.chip.rep": { ko: "보고서", en: "Report" },
  "os.chip.rep.title": { ko: "학부모 보고서 작성·발송 여부", en: "Whether the parent report is written and sent" },
  "os.list.empty": { ko: "해당 반 학생이 없습니다", en: "No students in this class" },
  "os.list.noClass": { ko: "기타", en: "Unassigned" },
  "os.list.caption": { ko: "학생 · 반별", en: "Students by class" },
  "os.list.expandAll": { ko: "모두 펼치기", en: "Open all" },
  "os.list.collapseAll": { ko: "모두 접기", en: "Close all" },
  "os.list.count": { ko: "{n}명", en: "{n} students" },
  "os.att.noPerm": {
    ko: "출결 입력 권한이 없습니다 — 학원설정(역할·권한)에서 원장님이 열어줄 수 있습니다",
    en: "You do not have permission to record attendance — the director can open it in the academy settings (roles and permissions)",
  },
  "os.att.empty": { ko: "출결 —", en: "Attendance —" },
  "os.att.otherStates": {
    ko: "조퇴·공결·보강 상태는 출석부에서 변경하세요 (원스크린 pill은 출석/지각/결석만)",
    en: "Change early leave, excused and makeup on the attendance sheet (these pills do present, late and absent only)",
  },
  "os.att.group": { ko: "{name} 출결", en: "{name} attendance" },
  "os.att.editNote": {
    ko: "{label} — 사유 메모 수정 (기록 지우기는 출석부에서)",
    en: "{label} — edit the reason (clear the record on the attendance sheet)",
  },
  "os.att.markWithNote": {
    ko: "{label}로 기록 — 사유 메모를 적을 수 있습니다",
    en: "Record as {label} — you can add a reason",
  },
  "os.att.already": {
    ko: "{label} (기록 지우기는 출석부에서)",
    en: "{label} (clear the record on the attendance sheet)",
  },
  "os.att.mark": { ko: "{label}로 기록", en: "Record as {label}" },
  "os.att.noteLabel": { ko: "{name} · {label} 사유", en: "{name} · reason for {label}" },
  "os.att.notePh": { ko: "예: 학원버스 지연 / 병결(부모 연락)", en: "e.g. shuttle was late / sick (parent called)" },
  "os.att.cancel": { ko: "취소", en: "Cancel" },
  "os.att.save": { ko: "저장", en: "Save" },
  // 자리 출석부 사유 팝업이 **입력하는 동안 저장**할 때(원장 2026-09-10 *"실시간 저장도"*) — 그 자리엔
  // '취소'가 서지 않으므로(이미 저장된 글이라 거짓말) 대신 이 문장을 적는다.
  "os.att.autosave": { ko: "자동 저장됩니다", en: "Saved as you type" },
  "os.units.absent": {
    ko: "결석은 수업타임(시수)을 쓰지 않습니다 — 출석·지각으로 바꾸면 입력할 수 있습니다",
    en: "An absence uses no class units — switch to present or late to enter them",
  },
  "os.units.aria": { ko: "{name} 수업타임", en: "{name} class units" },
  "os.units.title": {
    ko: "{name} 수업타임 — 기본 1타임. 한 타임 더 했으면 2로 고치면 출석부에 그대로 들어갑니다.",
    en: "{name} class units — 1 by default. If you taught one more, change it to 2 and it goes straight into the attendance sheet.",
  },
  // 수학 자동 시수(원장 2026-09-11) — 출결이 비어 있는 칸에만 붙는다(처음 찍을 때 들어갈 값).
  "os.units.titleAuto": {
    ko: " (이 수업은 수업 길이로 기본 {n}타임이 들어갑니다)",
    en: " (this class records {n} units by default, from its length)",
  },
  "os.units.titleNoStatus": {
    ko: " (지금 출결이 비어 있어 '출석'으로 함께 기록됩니다)",
    en: " (attendance is empty, so it will be recorded as present at the same time)",
  },
  "os.units.titleTail": {
    ko: " ※ 학부모 보고서에는 나가지 않습니다. 급여 시수에는 반영됩니다.",
    en: " Note: this is never shown to parents, but it does count towards paid hours.",
  },
  "os.status.sent": { ko: "발송완료", en: "Sent to parents" },
  "os.status.draft": { ko: "작성중", en: "Being written" },
  "os.status.todo": { ko: "미작성", en: "Not written" },
  "os.status.excluded": { ko: "미발송 반", en: "No-send class" },
  "os.status.noClass": { ko: "반 미배정", en: "No class assigned" },
  "os.status.empty": { ko: "오늘 담당 학생이 없습니다", en: "No students of yours today" },
  "os.status.parentRead": { ko: "학부모 열람", en: "Parents read" },
  "os.status.unsent": { ko: "아직 안 보낸 {n} / 전체 {total}", en: "{n} still unsent of {total}" },
  "os.status.excludedTail": { ko: " · 미발송 반 {n} 제외", en: " · {n} in no-send classes left out" },
  "os.status.colProgress": { ko: "오늘 진도", en: "Today's progress" },
  "os.status.colReport": { ko: "보고서", en: "Report" },
  "os.status.colViews": { ko: "열람", en: "Reads" },
  "os.status.todoN": { ko: "미작성 {n}", en: "{n} not written" },
  "os.status.noSendClass": { ko: "수업보고서 미발송 반 — 출결만 기록", en: "No-send class — attendance only" },
  "os.status.allWritten": { ko: "전원 작성", en: "All written" },
  "os.status.views": { ko: "{n}회", en: "{n}×" },

  // ── 원스크린 표 본문·점수/과제 칸·진도 카드 ─────────────────────
  "os.row.progressPh": { ko: "오늘 진도 (예: Unit 8 · p.90)", en: "Today's progress (e.g. Unit 8 · p.90)" },
  "os.row.progressAria": { ko: "{name} {subject} 오늘 진도", en: "{name} {subject} today's progress" },
  "os.row.modeAria": { ko: "{name} {subject} 오늘 수업 성격", en: "{name} {subject} what today's lesson was" },
  "os.row.absentMent": { ko: "결석 — 학부모 문구는 발송되지 않습니다", en: "Absent — the parent message will not be sent" },
  "os.row.sentLocked": { ko: "발송 완료 — 수정할 수 없습니다", en: "Already sent — this cannot be edited" },
  "os.row.absentNote": {
    ko: "결석 — 사유는 왼쪽 출결에서 적어 주세요",
    en: "Absent — write the reason in the attendance box on the left",
  },
  "os.row.pickAria": { ko: "{name} {subject} 선택", en: "Select {name} {subject}" },
  "os.row.makeupRemove": {
    ko: "클릭하면 이 보강을 뺍니다(출결·보강 보고서·진도 기록이 삭제됩니다)",
    en: "Click to remove this makeup (its attendance, makeup report and progress record are deleted)",
  },
  "os.row.makeupRemoveAria": { ko: "{name} 보강 빼기", en: "Remove the makeup for {name}" },
  "os.row.makeupRemoveAria2": {
    ko: "{name} {subject} 보강 빼기",
    en: "Remove the {subject} makeup for {name}",
  },
  "os.row.unreadTitle": {
    ko: "최근 보고서 {n}건을 학부모가 아직 확인하지 않았습니다 — 다른 경로(직접 안내 등) 확인이 필요할 수 있어요",
    en: "Parents have not opened the last {n} reports — you may need to reach them another way",
  },
  "os.row.unread": { ko: "학부모 미확인 {n}회", en: "{n} unopened by parents" },
  "os.row.jumpTitle": {
    ko: "진도 기록에 점프·겹침이 감지됐습니다 — 점프는 같은 선생님이 쓴 직전 진도와 비교합니다(담당이 다른 진도는 경고하지 않습니다). 학생 상세 > 진도 탭에서 확인하세요",
    en: "A jump or overlap was found in the progress record — a jump is measured against the previous entry by the same teacher (entries by another teacher are not flagged). Check it under Student details → Progress.",
  },
  "os.row.jump": { ko: "진도 확인 필요", en: "Check the progress" },
  "os.units.noPerm": {
    ko: "출결 입력 권한이 없어 수업타임을 고칠 수 없습니다",
    en: "You cannot change class units without attendance permission",
  },
  "os.units.noClass": {
    ko: "이 행은 반이 없어 출석부에 기록할 자리가 없습니다 — 수업타임은 출석부에서 입력하세요",
    en: "This row has no class, so there is nowhere in the attendance sheet to record it — enter class units there instead",
  },
  "os.row.dailyLabel": { ko: "{name} 일일테스트", en: "{name} daily test" },
  "os.row.checkLabel": { ko: "{name} 확인테스트", en: "{name} check test" },
  "os.row.attitudeAria": { ko: "{name} 태도", en: "{name} attitude" },
  "os.row.hwLabel": { ko: "{name} 과제 수행률", en: "{name} homework done" },
  "os.row.bookPh": { ko: "교재명", en: "Book" },
  "os.row.bookAria": { ko: "{name} {subject} 교재명", en: "{name} {subject} book" },
  "os.row.hwTodayPh": { ko: "오늘 과제", en: "Today's homework" },
  "os.row.hwTodayTitle": {
    ko: "오늘 내준 과제 — 예: 개념편 p10~16",
    en: "The homework you set today — e.g. Concepts p10–16",
  },
  "os.row.hwTodayAria": { ko: "{name} {subject} 오늘 과제", en: "{name} {subject} today's homework" },
  "os.row.makeupBoth": {
    ko: "그날 정규 수업에 더해 보강까지 한 경우 — 학부모 보고서 제목이 '(정규+보강)'이 되고 한 건만 나갑니다",
    en: "For a day you taught the regular class and a makeup as well — the parent report is titled as a combined lesson and only one is sent",
  },
  "os.row.makeupOnly": {
    ko: "보강(수업외) 수업 — 학부모 보고서 제목이 '(보강)'이 됩니다",
    en: "A makeup lesson (outside the regular class) — the parent report is titled as a makeup",
  },
  "os.row.makeupAria": { ko: "{name} {subject} 보강", en: "{name} {subject} makeup" },
  "os.row.notePh": {
    ko: "특이사항(메모) · 예: 조퇴함 / 개념 어려워함",
    en: "Notes · e.g. left early / found the concept hard",
  },
  "os.row.noteAria": { ko: "{name} 특이사항", en: "{name} notes" },
  "os.row.ment1Ph": {
    ko: "1문단 · 수업 내용(교재·진도·과제)",
    en: "Block 1 · what we covered (book, progress, homework)",
  },
  "os.row.ment1Aria": {
    ko: "{name} {subject} 학부모 문구 1문단 수업 내용",
    en: "{name} {subject} parent message, block 1 — what we covered",
  },
  "os.row.ment2Ph": {
    ko: "2문단 · 태도 · 특이사항 · 직접 쓰거나 고친 멘트는 선생님 말투로 자동작성에 반영됩니다",
    en: "Block 2 · attitude and notes · what you write or edit yourself teaches Auto-write your voice",
  },
  "os.row.ment2Aria": {
    ko: "{name} {subject} 학부모 문구 2문단 태도 특이사항",
    en: "{name} {subject} parent message, block 2 — attitude and notes",
  },
  "os.row.mentPh": {
    ko: "'자동작성'으로 생성 · 직접 편집·확인 후 발송",
    en: "Use 'Auto-write', then edit and check before sending",
  },
  // 원장 2026-09-12: 직접 쓰거나 고친 멘트가 그 선생님 말투로 자동작성에 반영된다는 사실을 **이 칸에서** 알린다(0262a).
  // 🔴 프로파일을 읽는 행(영어 밖)에만 — 영어 행(템플릿 모드)은 위 mentPh 그대로(거짓 약속 금지).
  "os.row.mentPhVoice": {
    ko: "'자동작성'으로 생성 · 직접 편집·확인 후 발송 · 직접 쓰거나 고친 멘트는 선생님 말투로 자동작성에 반영됩니다",
    en: "Use 'Auto-write', then edit and check before sending · what you write or edit yourself teaches Auto-write your voice",
  },
  "os.row.mentAria": { ko: "{name} {subject} 학부모 문구", en: "{name} {subject} parent message" },
  "os.row.trendPh": {
    ko: "학습 추세(종합분석) · 기록 적으면 비어 있음",
    en: "Learning trend (overall) · empty when there is little record",
  },
  "os.row.trendAria": { ko: "{name} {subject} 학습 추세", en: "{name} {subject} learning trend" },
  "os.row.genSentLocked": {
    ko: "이미 발송된 보고서 — 수정할 수 없습니다",
    en: "This report has already been sent — it cannot be edited",
  },
  "os.row.genTitle": {
    ko: "AI 학부모 멘트 자동작성 (발송 문구)",
    en: "Auto-write the parent message with AI (the text that is sent)",
  },
  "os.row.genAbsent": {
    ko: "결석 학생 — 발송 제외 (기록 저장은 가능)",
    en: "Absent student — left out of the send (you can still save the record)",
  },
  "os.row.genNoProgress": { ko: "오늘 진도를 먼저 입력하세요", en: "Enter today's progress first" },
  "os.row.mentDone": { ko: "멘트", en: "Message" },
  "os.row.gen": { ko: "자동작성", en: "Auto-write" },
  "os.row.attachReadonly": {
    ko: "다른 강사 뷰(열람 전용) — 첨부를 바꿀 수 없습니다",
    en: "Another teacher's view (read-only) — attachments cannot be changed",
  },
  "os.row.attachSent": {
    ko: "이미 발송된 보고서 — 첨부를 바꿀 수 없습니다",
    en: "This report has already been sent — attachments cannot be changed",
  },
  "os.row.cardTitle": {
    ko: "카드로 열어 본문·첨부·링크 편집",
    en: "Open as a card to edit the text, attachments and link",
  },
  "os.row.card": { ko: "카드", en: "Card" },
  "os.row.bulkGenBusy": {
    ko: "전체 자동작성 중 — 완료 후 발송",
    en: "Auto-writing everything — send when it finishes",
  },
  "os.row.sent": { ko: "발송 완료", en: "Already sent" },
  "os.row.send": { ko: "발송", en: "Send" },
  "os.row.readTitle": { ko: "학부모 읽음 · {when}", en: "Read by parents · {when}" },
  "os.row.read": { ko: "학부모 읽음", en: "Read by parents" },
  "os.score.maxAria": { ko: "{label} 문항수", en: "{label} number of questions" },
  "os.score.maxTitle": { ko: "문항수(만점)", en: "Number of questions (full marks)" },
  "os.score.up": { ko: "점수 올림", en: "Score up" },
  "os.score.down": { ko: "점수 내림", en: "Score down" },
  "os.score.aria": { ko: "{label} 점수", en: "{label} score" },
  "os.hw.notSubmittedTitle": {
    ko: "과제를 내주었으나 제출하지 않음 (0%와 다른 문구로 나갑니다)",
    en: "Homework was set but not handed in (this reads differently from 0%)",
  },
  "os.hw.notSubmitted": { ko: "미제출", en: "Not handed in" },
  "os.hw.noneTitle": {
    ko: "내준 과제가 애초에 없던 날 (미제출 아님 — 문장에서 언급하지 않습니다)",
    en: "A day with no homework set (not the same as 'not handed in' — it is left out of the sentence)",
  },
  "os.hw.none": { ko: "없음", en: "None" },
  "os.delta.same": { ko: "동일", en: "Same" },
  "os.prev.date": { ko: "이전 {date}", en: "Last {date}" },
  "os.prev.homework": { ko: "과제 {text}", en: "Homework {text}" },
  "os.prev.rowTitle": {
    ko: "이전 회차 값을 이 행의 빈 칸에 채움 — 진도·태도·과제·오늘 과제 (특이사항 제외)",
    en: "Fills this row's empty boxes with last session's values — progress, attitude, homework and today's homework (notes are left out)",
  },
  "os.prev.rowGet": { ko: "가져오기", en: "Copy in" },
  "os.makeup.add": { ko: "+ 보강 학생 추가", en: "+ Add a makeup student" },
  "os.makeup.searchPh": { ko: "학생 이름 검색", en: "Search a student name" },
  "os.makeup.searchAria": { ko: "보강 학생 이름 검색", en: "Search a makeup student by name" },
  "os.makeup.searching": { ko: "검색 중…", en: "Looking…" },
  "os.makeup.noResult": { ko: "결과 없음", en: "No results" },
  "os.makeup.typeName": { ko: "이름을 입력하세요", en: "Type a name" },
  "os.present.title": {
    ko: "출결 기록이 없는 {n}칸을 출석으로 기록합니다 — 이미 찍힌 출석·지각·결석은 그대로 둡니다",
    en: "Marks the {n} empty boxes as present — anything already marked present, late or absent is left alone",
  },
  "os.present.allDone": {
    ko: "이 목록은 이미 전원 출결이 기록됐습니다",
    en: "Everyone in this list already has attendance recorded",
  },
  "os.present.none": {
    ko: "출결을 기록할 수 있는 학생이 없습니다",
    en: "There is no student whose attendance can be recorded",
  },
  "os.present.busy": { ko: "기록 중…", en: "Recording…" },
  "os.present.btn": { ko: "일괄 출석", en: "Present for all" },
  "os.attach.title": { ko: "첨부 {n}개 — 보기·추가·삭제", en: "{n} attachments — view, add or delete" },
  "os.attach.empty": { ko: "사진/파일 첨부", en: "Attach a photo or file" },
  "os.attach.aria": { ko: "{label} 첨부", en: "{label} attachments" },
  "os.attach.ariaN": { ko: "{label} 첨부 {n}개", en: "{label} — {n} attachments" },
  "os.attach.offA": { ko: "학원설정에서 ", en: "In the academy settings, " },
  "os.attach.offB": { ko: "사진/파일 첨부", en: "photo and file attachments" },
  "os.attach.offC": {
    ko: "가 꺼져 있어, 첨부해도 학부모 보고서·ClassNote에는 표시되지 않습니다.",
    en: " are turned off, so anything you attach will not appear in the parent report or on ClassNote.",
  },
  "os.attach.dropA": { ko: "파일을 ", en: "You can also " },
  "os.attach.dropB": { ko: "행 위에 끌어다 놓아도", en: "drag a file onto the row" },
  "os.attach.dropC": {
    ko: " 바로 첨부됩니다. 첨부하면 학부모 링크·ClassNote 게시글에 함께 실립니다.",
    en: " to attach it. Attachments ride along on the parent link and the ClassNote post.",
  },
  "os.attach.deleteAria": { ko: "{name} 삭제", en: "Delete {name}" },
  "os.attach.pickFile": { ko: "파일 선택", en: "Choose a file" },
  "os.test.title": { ko: "테스트 점수", en: "Test scores" },
  "os.test.kicker": { ko: "데일리 · 확인 테스트", en: "Daily and check tests" },
  "os.test.heading": { ko: "점수 입력", en: "Enter the scores" },
  "os.test.hint": { ko: "맞은 개수 / 문항수", en: "Correct / total" },
  "os.test.daily": { ko: "일일테스트", en: "Daily test" },
  "os.test.check": { ko: "확인테스트", en: "Check test" },
  "os.test.prevRange": { ko: "이전 진도 · {range}", en: "Last progress · {range}" },
  "os.test.todayRange": { ko: "오늘 진도 · {range}", en: "Today's progress · {range}" },
  "os.test.off": { ko: "테스트를 사용하지 않는 학원 설정입니다.", en: "This academy has tests turned off." },
  "os.pc.title": { ko: "오늘 진도", en: "Today's progress" },
  "os.pc.kicker": { ko: "진도 확인", en: "Progress check" },
  "os.pc.heading": { ko: "오늘 어디까지 나갔나요", en: "How far did you get today?" },
  "os.pc.loadPrev": { ko: "이전 진도 불러오기", en: "Load last progress" },
  "os.pc.confirmed": { ko: "확정됨", en: "Confirmed" },
  "os.pc.confirm": { ko: "오늘 진도 확정", en: "Confirm today's progress" },
  "os.pc.prev": { ko: "이전 · {text}", en: "Last · {text}" },
  "os.pc.noRecord": { ko: "기록 없음", en: "No record" },
  "os.pc.today": { ko: "오늘", en: "Today" },
  "os.pc.subjectProgressAria": { ko: "{subject} 오늘 진도", en: "{subject} today's progress" },
  "os.pc.inputPh": { ko: "오늘 진도 입력 (예: Unit 8 · p.90)", en: "Enter today's progress (e.g. Unit 8 · p.90)" },
  "os.pc.inputAria": { ko: "{subject} 오늘 진도 입력", en: "Enter {subject} today's progress" },
  "os.pc.modeAria": { ko: "{subject} 오늘 수업 성격", en: "{subject} — what today's lesson was" },

  // ── 발송 게이트(버튼 아래 사유)·멘트 경고 ──────────────────────
  "os.gate.readonly": { ko: "열람 전용", en: "Read-only" },
  "os.gate.readonlyHint": {
    ko: "다른 강사 뷰(열람 전용)에서는 발송할 수 없습니다 — 관리자뷰 또는 본인 강사뷰에서 보내세요",
    en: "You cannot send from another teacher's view (read-only) — send from the admin view or your own teacher view",
  },
  "os.gate.recall": { ko: "회수 처리 중", en: "Recall in progress" },
  "os.gate.recallHint": {
    ko: "학부모 게시글을 지우는 중입니다 — 끝나면 수정해서 다시 보낼 수 있습니다",
    en: "The parent post is being deleted — once that finishes you can edit and send again",
  },
  "os.gate.sent": { ko: "발송됨 — 재발송 불가", en: "Sent — cannot be sent again" },
  "os.gate.sentHint": {
    ko: "이미 학부모에게 발송된 보고서입니다 — ClassNote는 게시글 수정이 안 됩니다",
    en: "This report has already gone to the parents — ClassNote posts cannot be edited",
  },
  "os.gate.absent": { ko: "결석 — 발송 제외", en: "Absent — left out of the send" },
  "os.gate.absentHint": {
    ko: "결석 학생 — 발송 제외 (기록 저장은 가능)",
    en: "Absent student — left out of the send (the record can still be saved)",
  },
  "os.gate.need.attendance": { ko: "출결", en: "Attendance" },
  "os.gate.need.progress": { ko: "진도", en: "Progress" },
  "os.gate.need.ment": { ko: "멘트", en: "Message" },
  "os.gate.needLabel": { ko: "{list} 입력 필요", en: "{list} still needed" },
  "os.gate.hint.attendance": {
    ko: "출결이 아직 체크되지 않았습니다 — 출결 알약에서 출석/지각 등을 먼저 기록하세요(미체크 행은 발송되지 않습니다)",
    en: "Attendance has not been marked yet — record present, late and so on with the attendance pills first (unmarked rows are not sent)",
  },
  "os.gate.hint.progress": {
    ko: "오늘 진도를 입력해야 발송할 수 있습니다(보고서 본문의 뼈대)",
    en: "You must enter today's progress before sending (it is the backbone of the report)",
  },
  "os.gate.hint.ment": {
    ko: "학부모 전달 멘트가 비어 있습니다 — '자동작성'을 누르거나 직접 입력하세요(빈 보고서는 발송되지 않습니다)",
    en: "The parent message is empty — press 'Auto-write' or type it yourself (an empty report is not sent)",
  },
  "os.warn.examProgress": { ko: "진도 칸 확인", en: "Check the progress box" },
  "os.warn.scoreNotRecorded": { ko: "점수 칸 확인", en: "Check the score box" },
  "os.warn.examProgressHint": {
    ko: "멘트는 시험·평가를 봤다고 하는데 진도 칸에는 일반 차시가 적혀 있습니다 — 학부모 카드에는 둘 다 보입니다. 진도 칸을 '월말평가'처럼 바꾸면 카드와 멘트가 같은 말을 합니다.",
    en: "The message says there was a test, but the progress box has an ordinary lesson — parents see both. Change the progress box to the test name so the card and the message agree.",
  },
  "os.warn.scoreNotRecordedHint": {
    ko: "멘트에는 점수가 있는데 테스트 칸이 비어 있습니다 — 이 점수는 성적 추이·이력에 남지 않습니다. 점수는 테스트 칸에 넣어 주세요.",
    en: "The message has a score but the test box is empty — that score will not be kept in the grade history. Put it in the test box.",
  },

  // ── 원스크린 보고서 카드(카드 뷰) ──────────────────────────────
  "os.card.kicker": { ko: "today 보고서", en: "today report" },
  "os.card.kickerSubjects": { ko: "today 보고서 · 과목별", en: "today report · by subject" },
  "os.card.title": { ko: "{name} · 학부모 보고", en: "{name} · report to parents" },
  "os.card.makeup": { ko: "보강", en: "Makeup" },
  "os.card.jumpTitle": {
    ko: "진도 기록에 점프·겹침이 감지됐습니다 — 학생 상세 > 진도 탭에서 확인하세요",
    en: "A jump or overlap was found in the progress record — check it under Student details → Progress",
  },
  "os.card.saved": { ko: "기록 저장", en: "Record saved" },
  "os.card.attendance": { ko: "출결", en: "Attendance" },
  "os.card.units": { ko: "수업타임", en: "Class units" },
  "os.card.noClassAttendance": {
    ko: "이 행은 반이 없어 출석부에 기록할 자리가 없습니다 — 출결·수업타임은 출석부에서 입력하세요",
    en: "This row has no class, so there is nowhere in the attendance sheet to record it — enter the attendance and class units there instead",
  },
  "os.card.absentLockWord": { ko: "결석", en: "Absent" },
  "os.card.absentLockA": {
    ko: "이라 이 수업의 입력이 잠겨 있습니다 — 진도·테스트·태도·과제와 학부모 문구는 일어나지 않은 일이라 적지 않습니다. 사유·수업타임은 위 ",
    en: " — this lesson is locked for input. Progress, tests, attitude, homework and the parent message are left blank because none of it happened. You can still write the reason and the class units under ",
  },
  "os.card.absentLockWord2": { ko: "출결", en: "attendance" },
  "os.card.absentLockB": {
    ko: "에서 적을 수 있고, 잘못 눌렀다면 출결을 바꾸면 바로 열립니다.",
    en: " above, and if you pressed it by mistake, changing the attendance opens everything again.",
  },
  "os.card.bookPh": { ko: "교재명 (예: 개념원리 중2-1)", en: "Book (e.g. Concept Principles 2-1)" },
  "os.card.bookAria": { ko: "{subject} 교재명", en: "{subject} book" },
  "os.card.attitude": { ko: "수업 태도", en: "Attitude in class" },
  "os.card.attitudeAria": { ko: "{name} 수업 태도", en: "{name} attitude in class" },
  "os.card.hwTodayPh": {
    ko: "오늘 과제 (예: 개념편 p10~16, 유형편 p6~11)",
    en: "Today's homework (e.g. Concepts p10–16, Types p6–11)",
  },
  "os.card.hwTodayAria": { ko: "{subject} 오늘 과제", en: "{subject} today's homework" },
  "os.card.note": { ko: "특이사항 (메모)", en: "Notes (memo)" },
  "os.card.notePh": {
    ko: "예: 조퇴함 / 개념이 어려워 연습문제 한 번 더 · 자동작성 시 학부모 문장으로 풀어 씁니다",
    en: "e.g. left early / found the concept hard, so one more practice set · auto-write turns this into a sentence for parents",
  },
  "os.card.reportOf": { ko: "{subject} 보고서", en: "{subject} report" },
  "os.card.modeBTitle": {
    ko: "2문단 B — 수업 내용과 태도·특이사항을 나눠 작성합니다. 상단 토글에서 바꿀 수 있습니다.",
    en: "Two blocks (B) — what you covered and the attitude/notes are written separately. Change it with the toggle at the top.",
  },
  "os.card.modeATitle": {
    ko: "단일 A — 모든 내용을 한 문단으로 작성합니다. 상단 토글에서 바꿀 수 있습니다.",
    en: "One block (A) — everything is written as a single paragraph. Change it with the toggle at the top.",
  },
  "os.card.absentBadgeTitle": {
    ko: "결석 행은 학부모에게 발송되지 않습니다. 진도·태도 등 기록은 왼쪽에서 계속 입력할 수 있습니다.",
    en: "Absent rows are not sent to parents. You can keep entering the progress, attitude and the rest on the left.",
  },
  "os.card.generating": { ko: "생성 중…", en: "Writing…" },
  "os.card.para1": { ko: "1문단 · 수업 내용", en: "Block 1 · what we covered" },
  "os.card.para2": { ko: "2문단 · 태도 · 특이사항", en: "Block 2 · attitude · notes" },
  "os.card.para1Ph": {
    ko: "교재·진도·오늘 과제를 담은 첫 문단. '자동작성'이 {subject} 진도로 채워 줍니다.",
    en: "The first paragraph, with the book, progress and today's homework. 'Auto-write' fills it from the {subject} progress.",
  },
  "os.card.para2Ph": {
    ko: "수업 태도·특이사항을 담은 둘째 문단. 태도·특이사항이 비어 있으면 자동작성에서도 생략됩니다. 직접 쓰거나 고친 멘트는 선생님 말투로 자동작성에 반영됩니다.",
    en: "The second paragraph, with the attitude and notes. If both are empty, auto-write leaves it out too. What you write or edit yourself teaches Auto-write your voice.",
  },
  "os.card.mentPh": {
    ko: "'자동작성'을 누르면 {subject} 진도·테스트·태도로 초안을 만들어 줍니다. 그대로 보내거나 수정하세요. 직접 쓰거나 고친 멘트는 선생님 말투로 자동작성에 반영됩니다.",
    en: "Press 'Auto-write' and a draft is built from the {subject} progress, tests and attitude. Send it as it is or edit it. What you write or edit yourself teaches Auto-write your voice.",
  },
  "os.card.trend": { ko: "학습 추세 (종합분석)", en: "Learning trend (overall)" },
  "os.card.trendPh": {
    ko: "'자동작성'을 누르면 최근 시험·과제 점수 흐름을 요약해 줍니다. 기록이 적으면 비어 있을 수 있습니다.",
    en: "Press 'Auto-write' for a summary of the recent test and homework scores. It can stay empty when there is little record.",
  },
  // ── 영어 템플릿 모드(2026-09-10) — 영어 행 보고서 카드의 템플릿 칸 · 템플릿 관리 창 ──
  "os.card.templateBadge": { ko: "템플릿", en: "Template" },
  "os.card.templateBadgeTitle": {
    ko: "영어 보고서는 고른 템플릿에 진도·숙제·테스트와 AI 코멘트를 채워 만듭니다",
    en: "English reports fill the chosen template with the progress, homework, tests and an AI comment",
  },
  "os.card.mentPhTemplate": {
    ko: "'자동작성'을 누르면 고른 템플릿에 진도·숙제·테스트와 AI 코멘트를 채워 줍니다. 그대로 보내거나 수정하세요.",
    en: "Press 'Auto-write' to fill the chosen template with the progress, homework, tests and an AI comment. Send it as it is or edit it.",
  },
  "os.tpl.label": { ko: "템플릿", en: "Template" },
  "os.tpl.search": { ko: "템플릿 찾기", en: "Find a template" },
  "os.tpl.manage": { ko: "템플릿 관리", en: "Manage templates" },
  "os.tpl.nextTest": { ko: "다음 시간 테스트", en: "Next class test" },
  "os.tpl.nextTestPh": { ko: "예: 단어 시험 71~80번", en: "e.g. vocabulary test, words 71-80" },
  "os.tpl.refill": { ko: "템플릿으로 다시 채우기", en: "Refill from the template" },
  "os.tpl.refillTitle": {
    ko: "지금 진도·숙제·테스트 칸과 마지막 AI 코멘트로 글을 다시 만듭니다",
    en: "Rebuilds the text from the current progress, homework and test fields and the last AI comment",
  },
  "os.tpl.copy": { ko: "글 복사", en: "Copy the text" },
  "os.tpl.copied": { ko: "보고서 글을 복사했습니다", en: "Report text copied" },
  "os.tpl.copyEmpty": {
    ko: "복사할 글이 없습니다 — 먼저 자동작성을 눌러 주세요",
    en: "There is no text to copy yet — press Auto-write first",
  },
  "os.tpl.nameMissing": {
    ko: "AI 코멘트에 학생 이름이 없습니다 — 확인 후 넣어 주세요",
    en: "The AI comment doesn't mention the student's name — please add it",
  },
  "os.tpl.overwriteConfirm": {
    ko: "직접 고친 내용이 있습니다. 템플릿으로 다시 채우면 고친 내용이 사라집니다. 계속할까요?",
    en: "You edited this text. Refilling from the template replaces your edits. Continue?",
  },
  "os.tpl.aiFailed": {
    ko: "AI 코멘트를 만들지 못했습니다 — 글은 그대로 두었습니다. 잠시 후 다시 눌러 주세요",
    en: "Couldn't write the AI comment — the text was left as it was. Try again shortly",
  },
  "os.tpl.builtinName": { ko: "ECS 자동 (기본)", en: "ECS auto (built-in)" },
  "os.tpl.loading": {
    ko: "템플릿 목록을 불러오는 중입니다 — 잠시 후 다시 눌러 주세요",
    en: "Still loading your templates — try again in a moment",
  },
  "os.tpl.templateMissing": {
    ko: "고른 템플릿을 찾지 못해 기본 템플릿으로 채웠습니다",
    en: "The chosen template wasn't found, so the built-in one was used",
  },
  "os.tpl.editedDuringGen": {
    ko: "만드는 동안 글을 고치셔서 글은 그대로 두었습니다 — 새 AI 코멘트는 받아 두었으니 '다시 채우기'로 넣을 수 있습니다",
    en: "You edited the text while it was being written, so it was left as is — the new AI comment was kept; press Refill to use it",
  },
  "os.tpl.copyFailed": {
    ko: "복사하지 못했습니다 — 글을 직접 선택해 복사해 주세요",
    en: "Couldn't copy — please select the text and copy it yourself",
  },
  "os.tpl.listFailed": {
    ko: "내 템플릿을 불러오지 못했습니다. 기본 템플릿으로 계속할 수 있습니다",
    en: "Couldn't load your templates. You can keep going with the built-in one",
  },
  "os.tpl.stale": {
    ko: "템플릿이나 진도·숙제·테스트 칸이 바뀌어 글과 다릅니다 — 다시 채우기를 눌러 주세요",
    en: "The template or the progress, homework or test fields changed since the text was filled — press Refill",
  },
  "os.tpl.aiStale": {
    ko: "AI 인사말·코멘트가 고치기 전 값으로 쓰였습니다 — 자동작성을 다시 눌러 주세요",
    en: "The AI greeting or comment was written from the earlier values — press Auto-write again",
  },
  "os.tpl.listFailedRetry": {
    ko: "내 템플릿 목록을 불러오지 못해 이 행의 템플릿을 확인할 수 없습니다 — 화면을 새로 고친 뒤 다시 눌러 주세요",
    en: "Couldn't load your templates, so this row's template can't be checked — reload the screen and try again",
  },
  "os.tpl.needAiPending": {
    ko: "AI 인사말·코멘트가 아직 없어 지금 글은 '{current}' 템플릿 그대로입니다 — 자동작성을 누르면 고른 템플릿으로 바뀝니다",
    en: "No AI greeting or comment yet, so the text still uses '{current}' — press Auto-write to switch to the chosen template",
  },
  "os.tpl.templateGone": {
    ko: "이 글의 템플릿을 찾지 못했습니다(삭제됨) — 템플릿을 다시 골라 주세요",
    en: "This text's template can't be found (deleted) — please pick a template again",
  },
  "os.tpl.needAi": {
    ko: "AI 인사말·코멘트가 아직 없습니다 — 자동작성을 눌러 주세요",
    en: "No AI greeting or comment yet — press Auto-write",
  },
  "os.tpl.bulkSkipped": {
    ko: "영어 {n}행은 건너뛰었습니다(템플릿 목록 로딩·목록 오류·AI 오류·작성 중 수정) — 그 행은 따로 눌러 주세요(목록 오류면 화면을 새로 고친 뒤)",
    en: "{n} English rows were skipped (templates loading or unavailable, AI error or edited meanwhile) — do those rows one by one (reload first if the list failed)",
  },
  "os.tpl.autoOverwriteConfirm": {
    ko: "직접 고친 내용이 있습니다. 자동작성하면 고친 내용이 사라집니다. 계속할까요?",
    en: "You edited this text. Auto-write replaces your edits. Continue?",
  },
  "os.tpl.needAiFirst": {
    ko: "먼저 '자동작성'을 눌러 AI 인사말·코멘트를 만들어 주세요 — 다시 채우기는 만들어 둔 코멘트로 글만 다시 짭니다",
    en: "Press Auto-write first to create the AI greeting and comment — Refill only rebuilds the text around an existing comment",
  },
  "os.tpl.outdatedSend": {
    ko: "이 글에 고치기 전 값(점수·진도, 또는 그 값으로 쓴 AI 인사말·코멘트)이 남아 있습니다. 그대로 보낼까요? (다시 채우기·자동작성으로 맞출 수 있습니다)",
    en: "This text still carries earlier values (scores or progress, or an AI greeting or comment written from them). Send it as is? (Refill or Auto-write brings it up to date)",
  },
  "os.tpl.outdatedSave": {
    ko: "이 글에 고치기 전 값(점수·진도, 또는 그 값으로 쓴 AI 인사말·코멘트)이 남아 있습니다. 그대로 저장할까요? (학부모 링크·인쇄에 그대로 보입니다 · 다시 채우기·자동작성으로 맞출 수 있습니다)",
    en: "This text still carries earlier values (scores or progress, or an AI greeting or comment written from them). Save it as is? (parents see it as is via the link or print · Refill or Auto-write brings it up to date)",
  },
  "os.tpl.bulkSaveOutdated": {
    ko: "영어 {n}명의 글에 고치기 전 값이 남아 있습니다 — {names}{more}\n그대로 저장할까요? (학부모 링크·인쇄에 그대로 보입니다 · 다시 채우기·자동작성으로 맞출 수 있습니다)",
    en: "{n} English students' texts still carry earlier values — {names}{more}\nSave as is? (parents see it as is via the link or print · Refill or Auto-write brings it up to date)",
  },
  "os.tpl.outdatedLink": {
    ko: "이 글에 고치기 전 값이 남아 있고, 저장된 글이 링크로 그대로 보입니다 — 그래도 링크를 복사할까요?",
    en: "This text still carries earlier values, and the link shows the saved text as is. Copy the link anyway?",
  },
  "os.tpl.outdatedCopy": {
    ko: "이 글에 고치기 전 값(점수·진도, 또는 그 값으로 쓴 AI 인사말·코멘트)이 남아 있습니다. 그대로 복사할까요? (다시 채우기·자동작성으로 맞출 수 있습니다)",
    en: "This text still carries earlier values (scores or progress, or an AI greeting or comment written from them). Copy it as is? (Refill or Auto-write brings it up to date)",
  },
  "os.tpl.gridStale": { ko: "칸이 바뀜", en: "Fields changed since fill" },
  "os.tpl.gridAiStale": { ko: "AI 글 옛 값", en: "AI text outdated" },
  "os.tpl.gridNeedAi": { ko: "AI 글 없음", en: "No AI text yet" },
  "os.tpl.gridName": { ko: "이름 없음", en: "Student name missing" },
  "os.tpl.lineOutdated": {
    ko: "\n영어 {n}명의 글에 고치기 전 값이 남아 있습니다 — {names}{more} (다시 채우기·자동작성으로 맞출 수 있습니다)",
    en: "\n{n} English students' texts still carry earlier values — {names}{more} (Refill or Auto-write brings it up to date)",
  },
  "os.tpl.mgrTitle": { ko: "내 보고서 템플릿", en: "My report templates" },
  "os.tpl.mgrDesc": {
    ko: "아래 칸을 눌러 넣으면 학생마다 자동으로 채워집니다. 비어 있는 칸의 줄은 보낼 때 빠집니다.",
    en: "Insert the fields below and they are filled in for each student. Lines whose fields are empty are left out when sending.",
  },
  "os.tpl.builtIn": { ko: "기본", en: "Built-in" },
  "os.tpl.new": { ko: "새 템플릿", en: "New template" },
  "os.tpl.copyBuiltIn": { ko: "기본 템플릿 복사해서 만들기", en: "Copy the built-in template" },
  "os.tpl.copyName": { ko: "{name} 복사", en: "{name} (copy)" },
  "os.tpl.name": { ko: "템플릿 이름", en: "Template name" },
  "os.tpl.body": { ko: "템플릿 내용", en: "Template text" },
  "os.tpl.tokens": { ko: "넣을 칸 — 누르면 커서 자리에 들어갑니다", en: "Fields — click to insert at the cursor" },
  "os.tpl.preview": { ko: "미리보기 (예시 값)", en: "Preview (sample values)" },
  "os.tpl.unknown": {
    ko: "없는 칸이 있습니다: {tokens} — 이대로는 저장할 수 없습니다",
    en: "Unknown fields: {tokens} — the template can't be saved like this",
  },
  "os.tpl.save": { ko: "템플릿 저장", en: "Save template" },
  "os.tpl.saved": { ko: "템플릿을 저장했습니다", en: "Template saved" },
  "os.tpl.delete": { ko: "템플릿 삭제", en: "Delete template" },
  "os.tpl.deleteConfirm": { ko: "이 템플릿을 지울까요?", en: "Delete this template?" },
  "os.tpl.deleted": { ko: "템플릿을 지웠습니다", en: "Template deleted" },
  "os.tpl.builtInReadonly": {
    ko: "기본 템플릿은 고칠 수 없습니다 — 복사해서 내 템플릿으로 만드세요",
    en: "The built-in template can't be edited — copy it to make your own",
  },
  // ── 인재원 그림 칸(2026-09-11) — 시험 결과지·학습 분석지 ──
  "os.tpl.builtinJjName": { ko: "ECS 자동 + 인재원 결과지", en: "ECS auto + Injaewon sheets" },
  "os.tpl.jjLoading": { ko: "인재원 자료를 불러오는 중…", en: "Loading Injaewon data…" },
  "os.tpl.jjUnlinked": {
    ko: "인재원 미연결 — 결과지·학습분석지 칸은 비워 둡니다",
    en: "Not linked to Injaewon — the result sheet fields stay empty",
  },
  "os.tpl.jjUnlinkedTitle": {
    ko: "성적관리 › 영어 › JJ실에서 이 학생을 인재원 학생과 연결하면 결과지·학습분석지가 들어갑니다",
    en: "Link this student to their Injaewon account under Grades › English › JJ room to include the result sheets",
  },
  "os.tpl.jjSummary": {
    ko: "인재원 · 오늘 시험 {exams}건 · 30일 학습 {answers}문제",
    en: "Injaewon · {exams} tests today · {answers} answers in 30 days",
  },
  "os.tpl.jjFailed": { ko: "인재원 자료를 불러오지 못했습니다", en: "Couldn't load Injaewon data" },
  "os.tpl.jjRetry": { ko: "다시 불러오기", en: "Load again" },
  // 받아 둔 인재원 하루치를 **새로** 받는다(수업 중 본 시험·방금 이은 짝 반영, 2026-09-11 적대 리뷰).
  "os.tpl.jjReload": { ko: "새로 고침", en: "Refresh" },
  "os.tpl.slotHelp": {
    ko: "그림 칸 — 그 줄 자리에 인재원 그림이 들어갑니다 · 자료가 없으면 줄이 빠집니다",
    en: "Image fields — an Injaewon sheet goes where the line is · the line is left out when there is no data",
  },
  // 템플릿 미리보기의 그림 칸 = 예시 자료로 그린 **실제** 결과지(2026-09-11 후속 — '들어갑니다' 상자 대신).
  "os.tpl.sampleSheet": {
    ko: "예시 자료로 그린 모양 — 보고서에는 그 학생의 인재원 자료가 들어갑니다",
    en: "Drawn from sample data — the report uses the student's own Injaewon data",
  },
  "os.tpl.attachmentInTemplate": {
    ko: "사진·PDF 자리 줄은 템플릿에 넣을 수 없습니다 — 보고서 글에서 '사진·PDF 넣기'로 넣습니다",
    en: "Photo/PDF lines can't go in a template — add them in the report text with 'Insert a photo or PDF'",
  },
  "os.tpl.jjLinkGo": { ko: "연결하러 가기", en: "Link now" },
  "os.tpl.jjAskAdmin": { ko: "관리자에게 연결을 요청하세요", en: "Ask an admin to link this student" },
  // ── 영어 글 속 사진·PDF(2026-09-11) — 글의 커서 줄에 넣고, 사진은 넣기 전에 자른다 ──
  "os.media.add": { ko: "사진·PDF 넣기", en: "Insert a photo or PDF" },
  "os.media.help": {
    ko: "글에서 넣을 줄을 먼저 누르세요 — 그 줄 아래에 들어갑니다 · 사진은 넣기 전에 자를 수 있습니다",
    en: "Click the line in the text first — it goes below that line · photos can be cropped first",
  },
  "os.media.full": {
    ko: "첨부가 가득 찼습니다 — 아래 첨부에서 하나를 지우면 넣을 수 있습니다",
    en: "Attachments are full — delete one below to insert another",
  },
  "os.crop.title": { ko: "사진 자르기", en: "Crop the photo" },
  "os.crop.desc": {
    ko: "모서리를 끌어 남길 부분을 고르세요 · 가운데를 끌면 옮겨집니다 · 그대로 넣어도 됩니다",
    en: "Drag a corner to choose what to keep · drag the middle to move it · or insert it as is",
  },
  "os.crop.loading": { ko: "사진을 여는 중…", en: "Opening the photo…" },
  "os.crop.loadFail": {
    ko: "이 사진은 여기서 미리 볼 수 없습니다 — 자르지 않고 넣을 수 있습니다",
    en: "This photo can't be previewed here — you can insert it without cropping",
  },
  "os.crop.reset": { ko: "처음대로", en: "Reset" },
  "os.crop.cancel": { ko: "취소", en: "Cancel" },
  "os.crop.done": { ko: "이대로 넣기", en: "Insert" },
  "os.crop.working": { ko: "자르는 중…", en: "Cropping…" },
  "os.crop.fail": {
    ko: "사진을 자르지 못했습니다 — 다시 해 보거나 자르지 않고 넣으세요",
    en: "Couldn't crop the photo — try again or insert it without cropping",
  },
  "os.tpl.jjWarnBulk": {
    ko: "\n그림 없이 저장된 영어 보고서 {n}건 — 인재원 자료를 받지 못했습니다(그 행을 열어 확인해 주세요)",
    en: "\n{n} English reports were saved without the Injaewon sheets — open those rows to check",
  },
  "os.card.queue": { ko: "ClassNote 발송", en: "Send to ClassNote" },
  "os.card.queueTitle": {
    ko: "저장 후 ClassNote 발송 큐에 올립니다 — 워커가 자동으로 게시합니다",
    en: "Saves it, then puts it in the ClassNote send queue — the worker posts it automatically",
  },
  "os.card.read": { ko: "읽음", en: "Read" },
  "os.card.sentLockWord": { ko: "입력이 잠겨 있습니다", en: "the inputs are locked" },
  "os.card.sentLockA": {
    ko: "이미 학부모 게시판에 올라간 보고서라 ",
    en: "This report is already on the parent board, so ",
  },
  "os.card.sentLockB": {
    ko: ". 게시글은 이미지로 올라가 있어, 여기서 내용만 바꿔도 학부모가 보는 화면은 그대로이고 기록만 갈라집니다. 고치려면 아래 ",
    en: ". The post went up as an image, so changing the text here leaves what parents see untouched and only splits the record. To fix it, use ",
  },
  "os.card.sentLockRecall": { ko: "회수", en: "Recall" },
  "os.card.sentLockC": {
    ko: "로 학부모 게시글을 지우세요 — 삭제가 끝나면 입력이 열리고, ",
    en: " below to delete the parent post — once it is gone the inputs open again and ",
  },
  "os.card.sentLockD": { ko: "으로 수정본을 다시 보낼 수 있습니다.", en: " sends the corrected version." },
  "os.card.recalledWord": { ko: "회수했습니다", en: "has been recalled" },
  "os.card.recalledA": { ko: "학부모 게시글을 ", en: "The parent post " },
  "os.card.recalledB": { ko: ". 내용을 고친 뒤 ", en: ". Fix the text, then press " },
  "os.card.recalledC": {
    ko: "을 누르면 수정본이 다시 올라갑니다(새 공유 링크가 발급됩니다).",
    en: " and the corrected version goes back up (a new share link is issued).",
  },
  "os.card.saveSentTitle": {
    ko: "이미 학부모에게 발송된 보고서 — 수정할 수 없습니다(고치려면 공유 링크 재발급)",
    en: "This report has already gone to the parents — it cannot be edited (reissue the share link to change it)",
  },
  "os.card.saveTitle": {
    ko: "보고서를 기록에 저장합니다 — 아래 학부모 공유 링크를 복사해 카톡·문자로 보낼 수 있습니다",
    en: "Saves the report to the record — copy the parent share link below and send it by message",
  },
  "os.card.saveSent": { ko: "발송됨 — 수정 불가", en: "Sent — cannot be edited" },
  "os.card.save": { ko: "저장", en: "Save" },
  "os.card.pdfTitle": { ko: "학부모 보고서 미리보기·인쇄", en: "Preview and print the parent report" },
  "os.card.uploading": { ko: "업로드 중…", en: "Uploading the file…" },
  "os.card.attachAdd": { ko: "사진/파일 추가", en: "Add a photo or file" },
  "os.card.attachOffAsk": { ko: "원장님께 문의하세요.", en: "Ask the director about it." },
  "os.card.attachHint": {
    ko: "사진/파일을 추가하면 학부모 링크·ClassNote 게시글에 함께 실립니다.",
    en: "Anything you add rides along on the parent link and the ClassNote post.",
  },
  "os.card.shareLink": { ko: "학부모 공유 링크", en: "Parent share link" },
  "os.card.views": { ko: "{n}회 열람", en: "opened {n}×" },
  "os.card.revoked": { ko: "취소됨", en: "Revoked" },
  "os.card.revokedHint": { ko: "이 링크는 열람이 차단됐습니다.", en: "This link has been blocked." },
  "os.card.reissue": { ko: "재발급", en: "Reissue" },
  "os.card.copy": { ko: "복사", en: "Copy" },
  "os.card.copied": { ko: "학부모 공유 링크를 복사했습니다", en: "The parent share link was copied" },
  "os.card.revoke": { ko: "취소", en: "Revoke" },

  // ── 진도 선택기(팝오버) ────────────────────────────────────────
  // ── 학부모 미리보기 껍데기(안쪽 카드는 한국어 고정) ────────────
  "os.preview.title": { ko: "학부모 화면 미리보기", en: "Preview of what parents see" },
  "os.preview.live": { ko: "왼쪽에서 고치면 바로 반영됩니다", en: "Edit on the left and it updates here" },
  "os.preview.pending": {
    ko: "첨부 {n}건은 업로드가 끝나면 미리보기에 나타납니다.",
    en: "{n} attachments appear in the preview once they finish uploading.",
  },

  "os.ps.aria": { ko: "진도", en: "Progress" },
  "os.ps.pickAria": { ko: "진도 선택", en: "Choose the lessons" },
  "os.ps.pickPh": { ko: "진도 선택…", en: "Choose the lessons…" },
  "os.ps.skipTitle": { ko: "진도 없이 제출", en: "Submit without progress" },
  "os.ps.skipHint": { ko: "· 시험 등 진도가 중단된 날", en: "· for a day the progress stopped, such as a test" },
  "os.ps.modeTitle": { ko: "오늘 수업 성격", en: "What today's lesson was" },
  "os.ps.modeHint": { ko: "· 안 고르면 새 진도로 나갑니다", en: "· if you pick nothing it goes out as new progress" },
  "os.ps.modeAria": { ko: "{label} 오늘 수업 성격", en: "{label} — what today's lesson was" },
  "os.ps.lockedA": { ko: "오늘은 ", en: "Today is " },
  "os.ps.lockedB": {
    ko: "라 진도 선택이 잠겨 있어요. 차시를 고르려면 위에서 ",
    en: ", so choosing lessons is locked. To pick lessons, press ",
  },
  "os.ps.lockedC": { ko: "를 한 번 더 눌러 해제하세요.", en: " once more above to clear it." },
  "os.ps.gradeAria": { ko: "진도 학년 선택", en: "Choose the progress grade" },
  "os.ps.actualGrade": { ko: "실제 {grade}", en: "Actually {grade}" },
  "os.ps.search": { ko: "단원·차시 검색", en: "Search units and lessons" },
  "os.ps.prev": { ko: "이전 진도:", en: "Last progress:" },
  "os.ps.selPre": { ko: "선택 ", en: "Selected " },
  "os.ps.selPost": { ko: "차시", en: " lessons" },
  "os.ps.clearAll": { ko: "모두 해제", en: "Clear all" },
  "os.ps.otherPre": { ko: "다른 학년 ", en: "Another grade — " },
  "os.ps.otherPost": { ko: "차시도 함께 선택됨: ", en: " lessons are also selected: " },
  "os.ps.clearOther": { ko: "다른 학년만 해제", en: "Clear the other grade only" },
  "os.ps.noResult": { ko: "검색 결과가 없습니다", en: "No matching lessons" },
  "os.ps.unitSelected": { ko: "선택 {n}", en: "{n} selected" },

  // ── 반 공통 서술 · ECS 시트 카드 · 발송 시간대 안내 ────────────
  "os.cn.title": {
    ko: "이 반의 오늘 수업 맥락을 한 번 적어두면, 자동작성이 학생별 점수·태도와 결합해 서로 다른 멘트를 만듭니다",
    en: "Write the context of today's lesson once and auto-write combines it with each student's scores and attitude to produce different messages",
  },
  "os.cn.titleOff": {
    ko: "반을 하나로 특정하면 그 반의 공통 수업 서술을 적을 수 있습니다(전체 보기·같은 이름 두 반은 비활성)",
    en: "Narrow the view to one class to write its shared lesson notes (turned off for the all view and for two classes with the same name)",
  },
  "os.cn.btn": { ko: "반 서술", en: "Class notes" },
  "os.cn.head": {
    ko: " 반 공통 수업 맥락 — 이후 자동작성부터 학생별 사실과 결합됩니다(이미 쓴 멘트는 안 건드림)",
    en: " — shared lesson context for this class. From the next auto-write on it is combined with each student's facts (messages already written are left alone)",
  },
  "os.cn.ph": {
    ko: "예: 오늘은 2단원 심화 문제 위주로 진행. 대체로 이해도가 좋았고 응용 문제에서 시간이 걸렸음",
    en: "e.g. today we worked mainly on the harder problems in unit 2. Understanding was good overall, though the applied problems took time",
  },
  "os.cn.aria": { ko: "반 공통 수업 서술", en: "Shared lesson notes for the class" },
  "os.cn.clear": { ko: "지우기", en: "Clear" },
  "os.ss.title": { ko: "ECS 시트 · 오늘 계획", en: "ECS sheet · today's plan" },
  "os.ss.applyTitle": {
    ko: "시트에 적힌 진도·교재·오늘 과제를 아래 입력칸에 다시 채웁니다(학생별 기록은 그대로 둡니다)",
    en: "Refills the boxes below with the progress, book and homework written on the sheet (each student's own record is left alone)",
  },
  "os.ss.progress": { ko: "진도", en: "Progress" },
  "os.ss.book": { ko: "교재", en: "Textbook" },
  "os.ss.hw": { ko: "과제", en: "Homework" },
  "os.ss.student": { ko: "이 학생", en: "This student" },
  "os.sw.title": { ko: "수업 보고서 발송 시간대 {hint}", en: "Lesson reports are sent between {hint}" },
  "os.sw.body": {
    ko: " — 지금은 시간대 밖입니다. 발송하면 예약돼 시간대가 열릴 때 자동 발송됩니다.",
    en: " — right now is outside that window. If you send it, it is queued and goes out automatically when the window opens.",
  },

  // ── 값 일괄 입력(팝오버) ───────────────────────────────────────
  "os.bulk.confirmCopy": {
    ko: "이미 입력된 진도·교재·오늘 과제도 맨 위 행 값으로 덮어씁니다. 계속할까요?",
    en: "The progress, book and homework already filled in will also be overwritten with the top row's values. Continue?",
  },
  "os.bulk.warnAll": {
    ko: "· 선택한 행이 없어 표시된 {n}행 전체에 적용됩니다. 이미 입력한 값도 덮어씁니다.\n  (빈 칸만 채우려면 '빈 칸만 채우기'를 켜세요)",
    en: "· No row is selected, so this applies to all {n} rows shown, overwriting values already entered.\n  (Turn on 'Fill empty cells only' to keep them.)",
  },
  "os.bulk.warnAtt": {
    ko: "· 출결 {n}건을 '{label}'으로 기록합니다 — 그중 {over}건은 이미 있는 기록을 덮어씁니다.\n  출결은 저장 즉시 출석부에 반영되며 여기서는 되돌릴 수 없습니다.",
    en: "· {n} attendance cells will be recorded as '{label}' — {over} of them overwrite an existing record.\n  Attendance goes into the attendance sheet the moment it is saved and cannot be undone here.",
  },
  "os.bulk.confirmTail": { ko: "계속할까요?", en: "Continue?" },
  "os.bulk.title": {
    ko: "선택(없으면 표시 전체) 행을 한 번에 채우기 — 직접 입력하거나 맨 위 행을 복사",
    en: "Fill the selected rows (or every row shown) at once — type the values or copy the top row",
  },
  "os.bulk.btn": { ko: "일괄 입력", en: "Bulk fill" },
  "os.bulk.targetPre": { ko: "대상 ", en: "Target: " },
  "os.bulk.targetPost": { ko: "행", en: " rows" },
  "os.bulk.targetSel": { ko: " (선택 행)", en: " (selected rows)" },
  "os.bulk.targetAll": { ko: " (표시 전체)", en: " (all rows shown)" },
  "os.bulk.modeInput": { ko: "직접 입력", en: "Type it in" },
  "os.bulk.modeCopy": { ko: "맨 위 행 복사", en: "Copy the top row" },
  "os.bulk.copyA": { ko: " 행을 아래 ", en: " row is copied into the " },
  "os.bulk.copyB": { ko: "행에 복사합니다", en: " rows below" },
  "os.bulk.copyNone": { ko: "복사할 아래 행이 없습니다", en: "There is no row below to copy into" },
  "os.bulk.copyWhat": { ko: "복사되는 것", en: "What gets copied" },
  "os.bulk.copyList": { ko: "진도 · 교재명 · 오늘 과제", en: "Progress · book · today's homework" },
  "os.bulk.copyNotA": {
    ko: "점수 · 태도 · 과제 수행 · 학부모 문구는 ",
    en: "Scores, attitude, homework done and the parent message are ",
  },
  "os.bulk.copyNotB": { ko: "복사되지 않습니다", en: "not copied" },
  "os.bulk.copyNotC": { ko: "(학생마다 다른 기록)", en: " (each student's own record)" },
  "os.bulk.copySkip": {
    ko: "다른 과목 행 · 발송 완료 행은 건너뜁니다",
    en: "Rows of another subject and rows already sent are skipped",
  },
  "os.bulk.subjectAria": { ko: "진도를 넣을 과목", en: "Subject to put the progress in" },
  "os.bulk.subjectOpt": { ko: "{name} ({n}행)", en: "{name} ({n} rows)" },
  "os.bulk.subjectOne": { ko: "{name} {n}행", en: "{name} · {n} rows" },
  "os.bulk.progressAria": { ko: "일괄 진도", en: "Bulk progress" },
  "os.bulk.subjectOnly": {
    ko: "{name} 행에만 들어갑니다 — 다른 과목 행은 그대로",
    en: "Only {name} rows are filled — rows of other subjects stay as they are",
  },
  "os.bulk.attNone": { ko: "적용 안 함", en: "Leave it alone" },
  "os.bulk.unitsAria": { ko: "일괄 출결 수업타임", en: "Bulk attendance class units" },
  "os.bulk.unitsTitle": {
    ko: "이번에 새로 기록되는 칸의 수업타임(시수) — 빈칸=기본 1. 이미 기록된 칸의 시수는 바꾸지 않습니다",
    en: "The class units for the cells newly recorded this time — empty means 1. Cells already recorded keep their units",
  },
  "os.bulk.unitsHint": {
    ko: "예: 3시간 반 = 1.5 · 빈칸 = 기본(1) · 기존 기록의 시수는 유지",
    en: "e.g. a three-and-a-half hour class = 1.5 · empty = 1 · units already recorded are kept",
  },
  // 수학 자동 시수(원장 2026-09-11) — 새 칸에 시수를 비우면 수업 길이 값이 들어갈 때만(1이 아닐 때).
  "os.bulk.unitsTitleAuto": {
    ko: "이번에 새로 기록되는 칸의 수업타임(시수) — 빈칸이면 수업 길이대로({list}) 들어갑니다. 이미 기록된 칸의 시수는 바꾸지 않습니다",
    en: "The class units for the cells newly recorded this time — empty uses each class length ({list}). Cells already recorded keep their units",
  },
  "os.bulk.unitsHintAuto": {
    ko: "예: 3시간 반 = 1.5 · 빈칸 = 수업 길이대로({list}) · 기존 기록의 시수는 유지",
    en: "e.g. a three-and-a-half hour class = 1.5 · empty = by class length ({list}) · units already recorded are kept",
  },
  "os.bulk.planRecord": { ko: "건 기록", en: " to record" },
  "os.bulk.planOver": { ko: " · 기존 기록 {n}건 덮어씀", en: " · {n} overwrite an existing record" },
  "os.bulk.planNone": { ko: "기록할 대상이 없습니다", en: "There is nothing to record" },
  "os.bulk.planSkip": { ko: " · 제외 {list}", en: " · skipped {list}" },
  "os.bulk.attHint": {
    ko: "저장 즉시 출석부에 기록됩니다 — 조퇴·공결·보강 행은 건드리지 않습니다",
    en: "It goes into the attendance sheet the moment it is saved — early-leave, excused and makeup rows are left alone",
  },
  "os.bulk.attitudeAria": { ko: "일괄 태도", en: "Bulk attitude" },
  "os.bulk.hwAria": { ko: "일괄 과제 수행률", en: "Bulk homework done" },
  "os.bulk.bookPh": { ko: "교재명 (비우면 적용 안 함)", en: "Book (leave it empty to skip)" },
  "os.bulk.bookAria": { ko: "일괄 교재명", en: "Bulk book" },
  "os.bulk.hwTodayPh": { ko: "오늘 과제 (비우면 적용 안 함)", en: "Today's homework (leave it empty to skip)" },
  "os.bulk.hwTodayAria": { ko: "일괄 오늘 과제", en: "Bulk today's homework" },
  "os.bulk.onlyFilled": { ko: "채운 필드만 적용됩니다", en: "Only the boxes you filled are applied" },
  "os.bulk.onlyEmpty": { ko: "빈 칸만 채우기", en: "Fill empty cells only" },
  "os.bulk.apply": { ko: "적용", en: "Apply" },
  "os.bulk.skipSame": { ko: "이미 같은 상태 {n}", en: "{n} already the same" },
  "os.bulk.skipFilled": { ko: "이미 기록됨 {n}", en: "{n} already recorded" },
  "os.bulk.skipSpecial": { ko: "조퇴·공결·보강 {n}", en: "{n} early-leave, excused or makeup" },
  "os.bulk.skipNoClass": { ko: "반 없음 {n}", en: "{n} with no class" },

  // ── 지난 보고서 목록 · 월간 발송 달력 ──────────────────────────
  "os.hist.loadFail": { ko: "불러오지 못했습니다", en: "It could not be loaded" },
  "os.hist.loadFailRetry": {
    ko: "보고서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
    en: "The reports could not be loaded — please try again in a moment",
  },
  "os.hist.moreFail": { ko: "더 불러오지 못했습니다", en: "No more could be loaded" },
  "os.hist.loading": { ko: "지난 보고서를 불러오는 중…", en: "Loading past reports…" },
  "os.hist.countOnDay": { ko: "이 날짜 보고서 {n}건", en: "{n} reports on this day" },
  "os.hist.countLoaded": { ko: "불러온 보고서 {n}건", en: "{n} reports loaded" },
  "os.hist.countSearch": { ko: " · 검색 결과 {n}건", en: " · {n} found" },
  "os.hist.noResult": { ko: "검색 결과가 없습니다", en: "No matching reports" },
  "os.hist.emptyDay": { ko: "이 날짜에 작성한 보고서가 없습니다", en: "No report was written on this day" },
  "os.hist.empty": { ko: "작성한 보고서가 없습니다", en: "No reports have been written" },
  "os.hist.groupCount": { ko: "{n}건 · 발송 {sent}", en: "{n} · {sent} sent" },
  "os.hist.unsent": { ko: "미발송", en: "Not sent yet" },
  "os.hist.views": { ko: "열람 {n}", en: "viewed {n}" },
  "os.hist.open": { ko: "보고서 보기", en: "Open the report" },
  "os.hist.truncated": {
    ko: "이 날짜 보고서가 많아 최근 {n}건만 표시했습니다",
    en: "There are many reports on this day — only the latest {n} are shown",
  },
  "os.hist.loadingMore": { ko: "불러오는 중…", en: "Loading…" },
  "os.hist.more": { ko: "이전 보고서 더 보기", en: "Show earlier reports" },
  "os.cal.dayTitle": { ko: "학부모 발송 {sent} / 작성 {target}건", en: "{sent} sent to parents / {target} written" },
  "os.cal.dayActionable": { ko: " · 지금 보낼 수 있는 건 {n}건", en: " · {n} can be sent right now" },
  "os.cal.dayBlocked": {
    ko: " · 남은 건은 지금 발송할 수 없습니다(옛 이관분·과목 설정·기한·결석 등)",
    en: " · the rest cannot be sent now (old imports, subject settings, the deadline, absences and so on)",
  },
  "os.cal.problem": { ko: "실패 {n}", en: "{n} failed" },
  "os.cal.sendable": { ko: "보낼 수 있음", en: "Can send" },
  "os.cal.sendableN": { ko: "보낼 수 있음 {n}", en: "Can send {n}" },
  "os.cal.pending": { ko: "대기 {n}", en: "{n} waiting" },
  "os.cal.modeList": { ko: "전체 목록", en: "Full list" },
  "os.cal.loadFail": { ko: "달력을 불러오지 못했습니다", en: "The calendar could not be loaded" },
  "os.cal.loadFailRetry": {
    ko: "달력을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
    en: "The calendar could not be loaded — please try again in a moment",
  },
  "os.cal.thisMonth": { ko: "이번 달", en: "This month" },
  "os.cal.sum": { ko: "작성 {n}건 · 학부모 발송 {sent}/{target}", en: "{n} written · {sent}/{target} sent to parents" },
  "os.cal.sumActionable": { ko: " · 보낼 수 있음 {n}", en: " · {n} can be sent" },
  "os.cal.sumProblem": { ko: " · 실패 {n}", en: " · {n} failed" },
  "os.cal.legendAll": { ko: "전부 발송", en: "All sent" },
  "os.cal.legendProblem": { ko: "실패 있음", en: "Has failures" },
  "os.cal.empty": { ko: "이 달에 작성한 보고서가 없습니다", en: "No report was written this month" },

  // ── 보고서 회수(강사 카드 · 사무실 목록 공용 버튼) ──────────────
  "os.recall.inFlight": { ko: "회수 처리 중", en: "Recalling" },
  "os.recall.inFlightTitle": {
    ko: "연동 PC가 ClassNote 게시글을 순차 삭제합니다",
    en: "The linked PC is deleting the ClassNote posts one by one",
  },
  "os.recall.btn": { ko: "회수", en: "Recall" },
  "os.recall.btnBusy": { ko: "요청 중…", en: "Requesting…" },
  "os.recall.btnTitle": {
    ko: "학부모 게시판에서 이 보고서 글을 삭제합니다 — 지운 뒤 수정해서 다시 보낼 수 있습니다",
    en: "Deletes this report from the parent board — once it is gone you can edit and send it again",
  },
  "os.recall.failed": { ko: "회수하지 못했습니다", en: "It could not be recalled" },
  "os.recall.done": {
    ko: "회수를 요청했습니다 — 연동 PC가 학부모 게시글을 삭제합니다",
    en: "The recall was requested — the linked PC deletes the parent post",
  },
  "os.recall.step1Title": { ko: "보고서를 회수합니다", en: "This recalls the report" },
  "os.recall.step1Body": {
    ko: "{who}학부모 게시판에 올라간 이 보고서 글을 삭제합니다. 공유 링크는 즉시 차단되고, 게시글은 연동 PC가 순차적으로 지웁니다. ",
    en: "{who}This deletes the report posted on the parent board. The share link is blocked at once and the linked PC removes the post shortly after. ",
  },
  "os.recall.step1Read": {
    ko: "주의: 이 보고서는 학부모가 이미 열람했습니다 — 지워도 본 내용은 되돌릴 수 없습니다. ",
    en: "Note: the parents have already opened this report — deleting it does not unsee what they read. ",
  },
  "os.recall.step1Tail": {
    ko: "삭제가 끝나면 입력이 열립니다 — 고쳐서 'ClassNote 발송'을 누르면 수정본이 다시 올라갑니다.",
    en: "Once it is deleted the inputs open again — fix it and press 'Send to ClassNote' to put the corrected version up.",
  },
  "os.recall.step1Ok": { ko: "회수 진행", en: "Go ahead" },
  "os.recall.step1Cancel": { ko: "그만두기", en: "Leave it" },
  "os.recall.step2Title": { ko: "회수하겠습니까?", en: "Recall it?" },
  "os.recall.step2Body": {
    ko: "{who}보고서를 학부모 게시판에서 삭제합니다. 이 동작은 되돌릴 수 없습니다.",
    en: "{who}The report is deleted from the parent board. This cannot be undone.",
  },
  "os.recall.step2Ok": { ko: "회수하겠습니다", en: "Yes, recall it" },
  "os.recall.step2Cancel": { ko: "취소", en: "Cancel" },
  "os.recall.who": { ko: "{name} 학생의 ", en: "For {name}: " },

  // ── 원스크린 화면 껍데기·토스트(onescreen-client) ───────────────
  "os.c.autosaveFail": { ko: "자동 저장에 실패했습니다", en: "Auto-save failed" },
  "os.c.emptyUnwritten": { ko: "미작성 학생이 없습니다", en: "No student is left unwritten" },
  "os.c.emptyWritten": { ko: "작성한 학생이 없습니다", en: "No student has been written yet" },
  "os.c.markSend": { ko: "학부모 발송", en: "Parent send" },
  "os.c.markSave": { ko: "보고서 저장", en: "Report saved" },
  "os.c.mentModeFail": { ko: "멘트 모드 저장에 실패했습니다", en: "The message mode could not be saved" },
  "os.c.mentModeAcademy": { ko: "멘트 모드: 학원 기본", en: "Message mode: academy default" },
  "os.c.mentModeSet": { ko: "멘트 모드: {mode}", en: "Message mode: {mode}" },
  "os.c.mentModeA": { ko: "단일 문단", en: "one block" },
  "os.c.mentModeB": { ko: "2문단 분리", en: "two blocks" },
  "os.c.fontSizeFail": {
    ko: "글씨 크기를 계정에 저장하지 못했습니다 — 이 화면에서는 적용됩니다",
    en: "The text size could not be saved to your account — it still applies on this screen",
  },
  "os.c.anchorFail": { ko: "출석부 보강 기록을 남기지 못했습니다 — {error}", en: "The makeup could not be written to the attendance sheet — {error}" },
  "os.c.addStudentFail": { ko: "학생을 추가하지 못했습니다", en: "The student could not be added" },
  "os.c.makeupAlready": {
    ko: "{name} — {subjects}는 이미 보강이 합쳐져 있습니다(정규+보강). 한 타임 더 했다면 수업타임을 올려 주세요.",
    en: "{name} — {subjects} already has the makeup merged in (regular + makeup). If you taught one more session, raise the class units.",
  },
  "os.c.removeMakeupTitle": { ko: "{name} 보강을 뺄까요?", en: "Remove the makeup for {name}?" },
  "os.c.removeMakeupLine1": {
    ko: "출결 기록·저장된 보강 수업보고서·그 수업으로 올라간 진도 기록이 모두 삭제됩니다.",
    en: "The attendance, the saved makeup report and the progress recorded for that lesson are all deleted.",
  },
  "os.c.removeMakeupLine2": {
    ko: "보강을 추가하기 전 상태로 돌아가며, 되돌릴 수 없습니다.",
    en: "It goes back to how it was before the makeup was added, and cannot be undone.",
  },
  "os.c.makeupAddedUnits": { ko: "{name} (보강) 추가됨 — 수업타임 {units}", en: "{name} (makeup) added — class units {units}" },
  "os.c.makeupAddedNoAnchor": {
    ko: "{name} (보강) 추가됨 — 반 필터가 '전체'라 출결에는 남기지 않았습니다(반을 고르면 함께 기록됩니다).",
    en: "{name} (makeup) added — the class filter is on 'All', so nothing was written to the attendance sheet (pick a class and it is recorded too).",
  },
  "os.c.cardNotFound": {
    ko: "학생 카드를 찾지 못했습니다 — 새로고침 후 다시 시도해 주세요",
    en: "The student card was not found — refresh and try again",
  },
  "os.c.absenceLinkFail": {
    ko: "보강은 추가됐지만 결석분 연결에 실패했습니다 — {error}",
    en: "The makeup was added but it could not be linked to the absence — {error}",
  },
  "os.c.makeupNoted": {
    ko: "{name} 보강 추가 — {date} 결석 칸에 메모, 수업타임 {units}",
    en: "Makeup added for {name} — a note on the absence of {date}, class units {units}",
  },
  "os.c.makeupNoRecord": {
    ko: "{name} 보강 추가 — 수업타임 {units}. {date} 칸엔 결석 기록이 없어 메모는 남기지 않았습니다.",
    en: "Makeup added for {name} — class units {units}. There is no absence recorded on {date}, so no note was left.",
  },
  "os.c.makeupUnitsFail": { ko: "보강 시수를 기록하지 못했습니다 — {error}", en: "The makeup units could not be recorded — {error}" },
  "os.c.makeupAlreadyLinked": {
    ko: "{date} 결석분 보강은 이미 기록돼 있습니다 — 수업타임을 다시 올리지 않았습니다.",
    en: "The makeup for the absence on {date} is already recorded — the class units were not raised again.",
  },
  "os.c.makeupNoted2": {
    ko: "{name} 보강 추가 — {date} 칸에 메모, {target} 수업타임 {units}",
    en: "Makeup added for {name} — a note on {date}, {target} class units {units}",
  },
  "os.c.makeupFuture": {
    ko: "{name} 보강 추가 — {target} 수업타임 {units}. {date}은 아직 오지 않은 날이라 그 칸엔 메모를 남기지 않았습니다(그날 출결을 입력할 때 적어 주세요).",
    en: "Makeup added for {name} — {target} class units {units}. {date} has not come yet, so no note was left there (write it when you record that day's attendance).",
  },
  "os.c.makeupNoRecord2": {
    ko: "{name} 보강 추가 — {target} 수업타임 {units}. 단 {date}엔 출결 기록이 없어 메모는 남기지 않았습니다.",
    en: "Makeup added for {name} — {target} class units {units}. There is no attendance on {date}, though, so no note was left.",
  },
  "os.c.makeupExtra": {
    ko: "{name} 보강 추가 — {target} 보고서 2건(정규·보강 따로) · 수업타임 {units}. 결석분 연결은 없습니다(추가 보강).",
    en: "Makeup added for {name} — 2 {target} reports (regular and makeup separately) · class units {units}. It is not linked to an absence (an extra makeup).",
  },
  "os.c.mergeSent": {
    ko: "{name} — {target} 보고서가 이미 발송되어 보강 내용은 보고서에 실리지 않습니다. 출석부 수업타임만 올렸습니다(수업타임 {units}).",
    en: "{name} — the {target} report has already been sent, so the makeup is not in it. Only the attendance class units were raised (class units {units}).",
  },
  "os.c.merged": {
    ko: "{name} 보강 합침 — {target} 보고서 1건(정규+보강) · 수업타임 {units}",
    en: "Makeup merged for {name} — one {target} report (regular + makeup) · class units {units}",
  },
  "os.c.makeupRowExists": { ko: "이미 보강 행이 추가되어 있습니다", en: "A makeup row has already been added" },
  "os.c.makeupAdded": { ko: "{name} 보강 추가됨", en: "Makeup added for {name}" },
  "os.c.prevFail": { ko: "이전 진도를 불러오지 못했습니다", en: "The last progress could not be loaded" },
  "os.c.prevLoaded": { ko: "이전 진도를 불러왔습니다", en: "The last progress was loaded" },
  "os.c.prevNone": { ko: "이전 보고서가 없습니다", en: "There is no earlier report" },
  "os.c.attRecorded": { ko: "기록됨", en: "on record" },
  "os.c.attConflict": {
    ko: "이미 출결이 기록되어 있어 덮지 않았습니다 (현재: {status}) — 바꾸려면 다시 눌러 주세요",
    en: "Attendance was already recorded, so it was not overwritten (now: {status}) — press again to change it",
  },
  "os.c.attFail": { ko: "출결 저장에 실패했습니다 — 네트워크를 확인해 주세요", en: "Attendance could not be saved — check the network" },
  "os.c.presentNone": {
    ko: "기록된 칸이 없습니다 — 이미 다른 곳에서 출결이 찍혔거나 담당 반·수강 대상이 아닙니다",
    en: "Nothing was recorded — either it was already marked elsewhere, or these are not your classes or enrolled students",
  },
  "os.c.presentDone": { ko: "일괄 출석 — {n}칸 기록", en: "Marked present in bulk — {n} cells" },
  "os.c.presentMissed": {
    ko: " · {n}칸은 그대로 뒀습니다(이미 기록됐거나 담당 반·수강 대상이 아님 — 새로고침하면 최신 기록이 보입니다)",
    en: " · {n} cells were left alone (already recorded, or not your class or an enrolled student — refresh to see the latest)",
  },
  "os.c.presentFail": { ko: "일괄 출석 저장에 실패했습니다 — 네트워크를 확인해 주세요", en: "The bulk present could not be saved — check the network" },
  "os.c.aiFallback": { ko: "AI 자동작성이 어려워 기본 문구로 작성했습니다", en: "The AI could not write it, so a default message was used" },
  "os.c.genNonePreserved": {
    ko: "자동작성할 새 행이 없습니다 — 멘트 있는 {n}건은 보존(개별 '자동작성'으로 재생성)",
    en: "There is no new row to auto-write — {n} rows with a message are kept (use the row's own 'Auto-write' to redo one)",
  },
  "os.c.genNone": { ko: "자동작성할 행이 없습니다 — 오늘 진도를 입력하세요", en: "There is no row to auto-write — enter today's progress" },
  "os.c.genDone": { ko: "{n}건 자동작성 완료", en: "Auto-wrote {n}" },
  "os.c.genPreserved": { ko: " · 멘트 보존 {n}건", en: " · {n} messages kept" },
  "os.c.genSkipped": { ko: " · 건너뜀 {n}(진도 미입력·결석)", en: " · {n} skipped (no progress, or absent)" },
  "os.c.doneRows": { ko: "{n}행 입력", en: "{n} rows filled" },
  "os.c.doneAttNone": { ko: "출결 0건", en: "attendance: none" },
  "os.c.doneAttSkip": { ko: "(제외: {why})", en: " (skipped: {why})" },
  "os.c.doneAtt": { ko: "출결 {n}건 기록", en: "attendance: {n} recorded" },
  "os.c.doneAttBlocked": { ko: " (담당 반·수강생이 아니어서 {n}건 제외)", en: " ({n} left out — not your class or an enrolled student)" },
  "os.c.doneAttWhy": { ko: " · 제외 {why}", en: " · skipped {why}" },
  "os.c.applyNone": { ko: "적용할 칸이 없습니다", en: "There is no cell to fill" },
  "os.c.applyDone": { ko: "일괄 적용 — {list}", en: "Bulk fill — {list}" },
  "os.c.copyNoRow": { ko: "복사할 아래 행이 없습니다", en: "There is no row below to copy into" },
  "os.c.copyWhyLocked": { ko: "입력 잠김 {n}행", en: "{n} rows locked" },
  "os.c.copyWhySubject": { ko: "다른 과목 {n}행", en: "{n} of another subject" },
  "os.c.copyWhyFilled": { ko: "이미 입력됨 {n}행", en: "{n} rows already filled" },
  "os.c.copyNoneWhy": { ko: "복사할 칸이 없습니다 — {why}", en: "There is no cell to copy into — {why}" },
  "os.c.copyNeedFirst": { ko: "맨 위 행에 먼저 진도를 입력하세요", en: "Enter the progress in the top row first" },
  "os.c.copyDone": { ko: "{name} 행을 {n}행에 복사했습니다", en: "Copied the {name} row into {n} rows" },
  "os.c.copySkipped": { ko: " · 건너뜀 {n}행({why})", en: " · {n} skipped ({why})" },
  "os.c.copySkipLocked": { ko: "입력 잠김 {n}", en: "{n} locked" },
  "os.c.copySkipSubject": { ko: "다른 과목 {n}", en: "{n} another subject" },
  "os.c.copySkipFilled": { ko: "이미 입력 {n}", en: "{n} already filled" },
  "os.c.prevFillNone": {
    ko: "가져올 빈 칸이 없습니다 — 이미 입력됐거나 이전 회차 값이 없습니다",
    en: "There is no empty cell to fill — they are filled already, or there is no value from last time",
  },
  "os.c.prevFillOne": { ko: "이전 회차 값으로 빈 칸 {n}개를 가져왔습니다", en: "Filled {n} empty cells from last time" },
  "os.c.prevFillMany": {
    ko: "{rows}행의 빈 칸 {cells}개를 이전 회차 값으로 가져왔습니다 (특이사항 제외)",
    en: "Filled {cells} empty cells across {rows} rows from last time (notes are left out)",
  },
  "os.c.prevComments": {
    ko: "{n}행의 멘트를 직전 회차 문구로 가져왔습니다 — 발송 전에 오늘 내용과 맞는지 확인하세요",
    en: "Filled the message in {n} rows with last time's text — check it matches today before sending",
  },
  "os.c.orderSaved": { ko: "학생 순서를 저장했습니다 — 다음 작성에도 유지됩니다", en: "The student order was saved — it stays next time too" },
  "os.c.bulkBusy": { ko: "일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요", en: "A bulk job is running — try again when it finishes" },
  "os.c.needProgress": { ko: "오늘 진도를 먼저 입력하세요", en: "Enter today's progress first" },
  "os.c.saveFail": { ko: "보고서 저장에 실패했습니다", en: "The report could not be saved" },
  "os.c.printTitle": { ko: "수업 보고서", en: "Lesson report" },
  "os.c.savedPreview": { ko: "{subject} 보고서 저장 — 미리보기를 열었습니다", en: "{subject} report saved — the preview is open" },
  "os.c.savedRecord": { ko: "{subject} 보고서를 기록에 저장했습니다", en: "The {subject} report was saved to the record" },
  "os.c.emptyMentSubject": {
    ko: "{subject} — 학부모 전달 멘트가 비어 있어 발송할 수 없습니다 (자동 작성 또는 직접 입력 후 발송)",
    en: "{subject} — the parent message is empty, so it cannot be sent (auto-write it or type it, then send)",
  },
  "os.c.queueFail": { ko: "ClassNote 발송 큐 적재에 실패했습니다", en: "It could not be put in the ClassNote send queue" },
  "os.c.recallingSubject": { ko: "{subject} — 회수 처리 중입니다. 게시글 삭제가 끝난 뒤에 보내세요", en: "{subject} — a recall is in progress. Send it once the post is deleted" },
  "os.c.revokedSubject": { ko: "{subject} — 취소된 링크입니다. 재발급 후 발송하세요", en: "{subject} — this link was revoked. Reissue it, then send" },
  "os.c.nameConflictSubject": {
    ko: "{subject} — 동명이인이 있어 자동 발송을 막았습니다. 학생 관리에서 'ClassNote 이름'을 구분(예: \"홍길동(중2)\") 지정 후 다시 발송하세요",
    en: "{subject} — two students share this name, so the send was blocked. Set a distinct 'ClassNote name' in student management, then send again",
  },
  "os.c.dryRunSubject": {
    ko: "{subject} — 저장됨(dry-run). 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 실제 전송됩니다",
    en: "{subject} — saved (dry run). Turn on real ClassNote sending in the director's report settings for it to go out",
  },
  "os.c.subjectOff": {
    ko: "{subject} — 저장했지만 이 과목은 발송 대상이 아니라 전송하지 않았습니다(원장 설정의 발송 과목 확인)",
    en: "{subject} — saved, but this subject is not one that gets sent, so nothing went out (check the subjects in the director's settings)",
  },
  "os.c.optoutSubject": { ko: "{subject} — {notice}(기록 저장은 유지)", en: "{subject} — {notice} (the record is still saved)" },
  "os.c.absentSubject": {
    ko: "{subject} — 수업일 출결이 결석으로 기록돼 있어 발송하지 않았습니다(기록 저장은 유지)",
    en: "{subject} — the attendance for that day is 'absent', so nothing was sent (the record is still saved)",
  },
  "os.c.uncheckedSubject": {
    ko: "{subject} — 출결이 아직 체크되지 않아 발송하지 않았습니다(출결 기록 후 다시 발송 · 저장은 유지)",
    en: "{subject} — attendance has not been marked, so nothing was sent (mark it and send again · the record is saved)",
  },
  "os.c.alreadySentSubject": {
    ko: "{subject} — 이미 학부모에게 발송된 보고서라 다시 보내지 않았습니다. 내용을 고쳤다면 '저장'을 누르세요",
    en: "{subject} — this report has already gone to the parents, so it was not sent again. If you changed it, press 'Save'",
  },
  "os.c.queuedWindow": { ko: "발송 예약됨 — 허용 시간대({hint})에 자동 발송됩니다", en: "Queued — it goes out automatically during the allowed window ({hint})" },
  "os.c.queuedWaiting": { ko: "발송 대기 — 워커가 자동으로 게시합니다", en: "Waiting to send — the worker posts it automatically" },
  "os.c.statusSuccess": { ko: "이미 발송 완료된 보고서입니다", en: "This report has already been sent" },
  "os.c.statusProcessing": { ko: "이미 처리 중입니다", en: "It is already being processed" },
  "os.c.statusTooOld": { ko: "오래된 보고서라 발송에서 제외됩니다", en: "This report is too old, so it is left out of the send" },
  "os.c.statusWaiting": { ko: "대기 중", en: "Waiting" },
  "os.c.queueResult": { ko: "{subject} ClassNote — {msg}", en: "{subject} ClassNote — {msg}" },
  "os.c.emptyMentRow": {
    ko: "{name} — 학부모 전달 멘트가 비어 있어 발송할 수 없습니다 (자동작성 또는 직접 입력 후 발송)",
    en: "{name} — the parent message is empty, so it cannot be sent (auto-write it or type it, then send)",
  },
  "os.c.sendFail": { ko: "발송에 실패했습니다", en: "It could not be sent" },
  "os.c.nameConflictRow": {
    ko: "{name} — 동명이인이 있어 발송을 막았습니다(학생 관리에서 ClassNote 이름 지정)",
    en: "{name} — two students share this name, so the send was blocked (set a ClassNote name in student management)",
  },
  "os.c.recallingRow": { ko: "{name} — 회수 처리 중입니다(삭제 후 발송)", en: "{name} — a recall is in progress (send after it is deleted)" },
  "os.c.revokedRow": { ko: "{name} — 취소된 링크입니다(재발급 필요)", en: "{name} — this link was revoked (reissue it first)" },
  "os.c.tooOldRow": { ko: "{name} — 오래된 보고서라 발송에서 제외됩니다", en: "{name} — this report is too old, so it is left out of the send" },
  "os.c.dryRunRow": { ko: "{name} — 저장됨(dry-run · 승인 전 실제 발송 안 함)", en: "{name} — saved (dry run · nothing really goes out before approval)" },
  "os.c.subjectOffRow": {
    ko: "{name} {subject} — 저장했지만 발송 대상 과목이 아니라 전송하지 않았습니다",
    en: "{name} {subject} — saved, but this subject is not one that gets sent, so nothing went out",
  },
  "os.c.optoutRow": { ko: "{name} {subject} — {notice}(기록 저장은 유지)", en: "{name} {subject} — {notice} (the record is still saved)" },
  "os.c.absentRow": {
    ko: "{name} — 수업일 출결이 결석으로 기록돼 있어 발송하지 않았습니다(기록 저장은 유지)",
    en: "{name} — the attendance for that day is 'absent', so nothing was sent (the record is still saved)",
  },
  "os.c.uncheckedRow": {
    ko: "{name} — 출결이 아직 체크되지 않아 발송하지 않았습니다(출결 기록 후 다시 발송 · 저장은 유지)",
    en: "{name} — attendance has not been marked, so nothing was sent (mark it and send again · the record is saved)",
  },
  "os.c.alreadySentRow": {
    ko: "{name} {subject} — 이미 학부모에게 발송된 보고서라 다시 보내지 않았습니다",
    en: "{name} {subject} — this report has already gone to the parents, so it was not sent again",
  },
  "os.c.queuedWindowRow": { ko: "{name} {subject} — 발송 예약됨({hint}에 자동 발송)", en: "{name} {subject} — queued (goes out automatically at {hint})" },
  "os.c.queuedRow": { ko: "{name} {subject} — 발송 대기", en: "{name} {subject} — waiting to send" },
  "os.c.saveNoneSent": {
    ko: "저장할 행이 없습니다 — 이미 발송된 {n}건은 수정할 수 없습니다(진도 미입력 행도 제외)",
    en: "There is no row to save — {n} already sent cannot be edited (rows with no progress are left out too)",
  },
  "os.c.saveNone": { ko: "저장할 행이 없습니다 — 오늘 진도를 입력하세요", en: "There is no row to save — enter today's progress" },
  "os.c.saveDone": { ko: "{n}건 저장 완료", en: "Saved {n}" },
  "os.c.saveFailN": { ko: " · {n}건 실패", en: " · {n} could not be saved" },
  "os.c.saveSkipped": { ko: " · 건너뜀 {n}(진도 미입력)", en: " · {n} skipped (no progress)" },
  "os.c.sendNoneSent": {
    ko: "발송할 새 행이 없습니다 — {n}건은 이미 학부모에게 발송됐습니다",
    en: "There is no new row to send — {n} have already gone to the parents",
  },
  "os.c.sendNone": {
    ko: "발송할 행이 없습니다 — 오늘 진도를 입력하세요 (결석·출결 미체크 행은 발송 제외)",
    en: "There is no row to send — enter today's progress (absent rows and unmarked attendance are left out)",
  },
  "os.c.lineProgress": {
    ko: "\n진도 미입력 {n}건은 발송에서 제외됩니다 — {names}{more} (진도 입력 후 다시 발송하세요)",
    en: "\n{n} rows with no progress are left out — {names}{more} (enter the progress and send again)",
  },
  "os.c.lineUnchecked": {
    ko: "\n출결 미체크 {n}건은 발송에서 제외됩니다 — {names}{more} (출결 체크 후 다시 발송하세요)",
    en: "\n{n} rows with unmarked attendance are left out — {names}{more} (mark the attendance and send again)",
  },
  "os.c.lineMore": { ko: " 외 {n}명", en: " and {n} more" },
  "os.c.lineGap": {
    ko: "\n태도 미입력 {attitude}명 · 테스트 미입력 {test}명 — 미입력 항목은 보고서에서 생략됩니다",
    en: "\n{attitude} with no attitude · {test} with no test — anything left blank is omitted from the report",
  },
  "os.c.lineMent": {
    ko: "\n멘트 미작성 {n}건은 발송에서 제외됩니다 — {names}{more} (멘트 작성 후 다시 발송하세요)",
    en: "\n{n} rows with no message are left out — {names}{more} (write the message and send again)",
  },
  "os.c.sendNoneMent": {
    ko: "발송할 행이 없습니다 — 멘트 미작성 {n}건 전부 제외됐습니다 (자동작성 또는 직접 입력 후 발송)",
    en: "There is no row to send — all {n} were left out for having no message (auto-write it or type it, then send)",
  },
  "os.c.lineAbsent": { ko: "\n결석 행 {n}건은 발송에서 제외됩니다", en: "\n{n} absent rows are left out of the send" },
  "os.c.lineSent": {
    ko: "\n이미 발송된 {n}건은 제외됩니다 — ClassNote는 게시글 수정이 안 돼 다시 보내면 글만 하나 더 붙습니다",
    en: "\n{n} already sent are left out — ClassNote posts cannot be edited, so sending again just adds another post",
  },
  "os.c.sendConfirm": {
    ko: "{n}건을 ClassNote로 일괄 발송할까요? (동명이인·취소·오래된 건은 자동 제외){lines}",
    en: "Send {n} to ClassNote in one go? (duplicate names, revoked links and old reports are left out automatically){lines}",
  },
  "os.c.bulkDry": { ko: "저장 {n}건(dry-run·발송 안 함) · ", en: "Saved {n} (dry run · nothing sent) · " },
  "os.c.bulkQueuedWindow": { ko: "발송 예약 {n}건({hint}에 자동 발송)", en: "Queued {n} (they go out at {hint})" },
  "os.c.bulkQueued": { ko: "발송 대기 {n}건", en: "{n} waiting to send" },
  "os.c.bulkSubjectOff": { ko: " · 과목 제외 {n}건(발송 대상 과목 아님)", en: " · {n} left out (not a subject that gets sent)" },
  "os.c.bulkAbsent": { ko: " · 결석 제외 {n}건", en: " · {n} left out as absent" },
  "os.c.bulkUnchecked": { ko: " · 출결 미체크 제외 {n}건", en: " · {n} left out with unmarked attendance" },
  "os.c.bulkOptout": { ko: " · 미발송 반 제외 {n}건", en: " · {n} left out (a class that does not send reports)" },
  "os.c.bulkSent": { ko: " · 발송완료 제외 {n}건", en: " · {n} left out as already sent" },
  "os.c.bulkBlocked": { ko: " · 차단 {n}건(동명이인/취소)", en: " · {n} blocked (duplicate name or revoked)" },
  "os.c.bulkSkipped": { ko: " · 제외 {n}건", en: " · {n} skipped" },
  "os.c.bulkPreSkipped": {
    ko: " · 대상 제외 {n}건(진도 미입력·출결 미체크·결석·발송완료)",
    en: " · {n} out of scope (no progress, unmarked attendance, absent or already sent)",
  },
  "os.c.bulkFail": { ko: " · 실패 {n}건", en: " · {n} failed to send" },
  "os.c.revokeFail": { ko: "링크 취소에 실패했습니다", en: "The link could not be revoked" },
  "os.c.revoked": { ko: "{subject} 공유 링크를 취소했습니다 — 학부모 열람이 차단됩니다", en: "The {subject} share link was revoked — parents can no longer open it" },
  "os.c.reissueConfirm": {
    ko: "이미 전달·게시된 옛 링크는 즉시 열리지 않게 됩니다. 새 링크를 발급할까요?",
    en: "The old link you already shared or posted stops working at once. Issue a new one?",
  },
  "os.c.reissueFail": { ko: "링크 재발급에 실패했습니다", en: "The link could not be reissued" },
  "os.c.reissued": { ko: "{subject} 공유 링크를 재발급했습니다 — 새 링크를 다시 전달하세요", en: "The {subject} share link was reissued — pass the new link on" },
  "os.c.attachNeedProgress": { ko: "오늘 진도를 입력한 뒤 첨부하세요", en: "Enter today's progress, then attach" },
  "os.c.attachNoInfo": { ko: "저장할 보고서 정보를 찾을 수 없습니다", en: "The report to save could not be found" },
  "os.c.attachIssueFail": { ko: "업로드 준비에 실패했습니다", en: "The upload could not be prepared" },
  "os.c.attachUploadFail": { ko: "업로드에 실패했습니다", en: "The upload failed" },
  "os.c.attachRegisterFail": { ko: "첨부 등록에 실패했습니다", en: "The attachment could not be registered" },
  "os.c.attachDone": { ko: "{n}개 첨부 — ClassNote는 다시 발송하세요", en: "{n} attached — send it to ClassNote again" },
  "os.c.attachDeleteFail": { ko: "첨부 삭제에 실패했습니다", en: "The attachment could not be deleted" },
  "os.c.attachDeleted": { ko: "첨부를 삭제했습니다", en: "The attachment was deleted" },
  "os.c.attachNoRow": { ko: "첨부된 행이 없습니다 — 진도를 입력한 행에만 첨부됩니다", en: "Nothing was attached — only rows with progress take attachments" },
  "os.c.attachBulk": { ko: "{rows}개 행에 {n}개 첨부", en: "Attached {n} across {rows} rows" },
  "os.c.attachBulkSkip": {
    ko: " · {n}행 건너뜀(진도 미입력·상한·고치기 전 값이 남은 영어 글)",
    en: " · {n} rows skipped (no progress, at the limit, or English text still carrying earlier values)",
  },
  "os.c.attachBulkTail": { ko: " — ClassNote는 다시 발송하세요", en: " — send it to ClassNote again" },
  "os.c.noClassTitle": { ko: "이 날짜에는 담당 수업이 없습니다", en: "You have no class on this date" },
  "os.c.noClassBody": { ko: "— 다른 날짜를 고르거나, 필요하면 담당 반 전체를 볼 수 있습니다.", en: "— pick another date, or view all of your classes if you need to." },
  "os.c.showAll": { ko: "담당 반 전체 보기", en: "View all my classes" },
  "os.c.showingAllTitle": { ko: "담당 반 전체 보기 — 이 날짜에 수업이 있는 학생이 아닙니다", en: "All my classes — these students do not have a lesson on this date" },
  "os.c.showingAllBody": { ko: "안 오는 날 입력·발송이 되지 않도록 주의하세요.", en: "Take care not to write or send on a day they do not come." },
  "os.c.showTodayOnly": { ko: "오늘 수업만 보기", en: "Show today's lessons only" },
  "os.c.sentBannerTitle": { ko: "이 날짜는 이미 학부모에게 발송된 보고서가 {n}건 있습니다", en: "{n} reports on this date have already gone to the parents" },
  "os.c.sentBannerA": { ko: "— 발송 완료된 건은 ", en: "— once sent, " },
  "os.c.sentBannerB": { ko: "그대로는 수정할 수 없습니다", en: "a report cannot be edited as it stands" },
  "os.c.sentBannerC": {
    ko: ". ClassNote는 게시글 수정이 없어 학부모가 받은 것과 기록이 갈라지기 때문입니다. 고쳐야 하면 카드에서 ",
    en: ". ClassNote posts cannot be edited, so the record would split from what the parents received. To fix one, use ",
  },
  "os.c.sentBannerD": { ko: "로 학부모 게시글을 지우세요 — 삭제가 끝나면 입력이 열리고 ", en: " on the card to delete the parent post — once it is gone the inputs open and " },
  "os.c.sentBannerE": { ko: "으로 수정본을 다시 보낼 수 있습니다.", en: " sends the corrected version." },
  "os.c.presenceTitle": { ko: "다른 창/기기에서 같은 날짜를 열어 두었습니다", en: "This date is open in another window or on another device" },
  // 🔴 문구가 곧 동작이다 — 2026-09-04에 빈 창이 잘 쓴 세션을 덮지 않게 바뀌면서 옛 문장
  //    ("마지막 저장이 덮어씁니다")은 **거짓**이 됐다. 동작이 또 바뀌면 여기도 함께 고칠 것.
  "os.c.presenceBody": { ko: "— 입력은 한 창에서만 하세요. 비어 있는 창은 이미 적힌 내용을 덮지 않습니다.", en: "— type in one window only. An empty window never overwrites what is already written." },
  // 이름이 겹치지 않게 `saveSkipped`(발송 요약의 " · 건너뜀 N")와 구분한다 — 뜻이 전혀 다르다.
  "os.c.saveIgnored": { ko: "다른 창에 이미 더 많이 입력된 내용이 있어 이 창의 저장은 반영하지 않았습니다", en: "Another window already has more written, so this window's save was not applied" },
  "os.c.staleWritten": { ko: "작성을 마친", en: "finished" },
  "os.c.staleEmptied": { ko: "문구가 비워진", en: "with the message cleared" },
  "os.c.staleCount": { ko: "{label} {n}명", en: "{n} {label}" },
  "os.c.staleBody": { ko: "이 목록에 남아 있습니다 — 입력 중 카드·행이 사라지지 않도록 유지합니다.", en: "are still in this list — they are kept so cards and rows do not vanish while you type." },
  "os.c.staleClear": { ko: "목록 정리", en: "Tidy the list" },
  "os.c.emptyUnwrittenAll": { ko: "미작성 학생이 없습니다 — 이 목록은 모두 작성했습니다", en: "No student is left unwritten — this list is complete" },
  "os.c.emptyWrittenNone": { ko: "작성한 학생이 아직 없습니다", en: "No student has been written yet" },
  "os.c.showAllFilter": { ko: "전체 보기", en: "Show all" },
  "os.c.narrativeSaved": { ko: "{name} 반 서술 저장 — 이후 자동작성부터 학생별 멘트에 반영됩니다", en: "Class notes saved for {name} — from the next auto-write on they shape each student's message" },
  "os.c.narrativeCleared": { ko: "{name} 반 서술을 지웠습니다", en: "Class notes cleared for {name}" },
  "os.c.reportHeading": { ko: "보고서", en: "Report" },
  "os.c.parentNoticeTitle": { ko: "이 학생 학부모에게 공지(진도·평가 없이 안내글만) 발송", en: "Send a notice to this student's parents (just the message, no progress or scores)" },
  "os.c.parentNotice": { ko: "학부모 공지", en: "Parent notice" },
  "os.c.pickStudent": { ko: "학생을 선택하세요", en: "Pick a student" },
  "os.c.prevCommentTitle": { ko: "멘트도 일괄 가져오시겠습니까?", en: "Fill the messages too?" },
  "os.c.prevCommentBody": {
    ko: "학부모 문구가 비어 있는 {n}개 행에 직전 회차에 보낸 멘트를 그대로 채웁니다. 오늘 진도·점수와 다를 수 있으니 발송 전에 확인·수정하세요.",
    en: "The {n} rows with an empty parent message are filled with the text sent last time. It may not match today's progress or scores, so check and edit before sending.",
  },
  "os.c.prevCommentOk": { ko: "멘트도 가져오기", en: "Fill them too" },
  "os.c.prevCommentCancel": { ko: "아니요", en: "No" },

  // ── 학부모 공지 작성(공지 뷰) ──────────────────────────────────
  "os.n.st.queued": { ko: "발송 대기", en: "Waiting to send" },
  "os.n.st.processing": { ko: "게시 중", en: "Posting" },
  "os.n.st.success": { ko: "게시 완료", en: "Posted" },
  "os.n.st.partial": { ko: "일부 게시", en: "Partly posted" },
  "os.n.st.failed": { ko: "게시 실패", en: "Posting failed" },
  "os.n.st.revokeRequested": {
    ko: "게시취소 요청됨(연동 PC 처리 대기)",
    en: "Take-down requested (waiting for the linked PC)",
  },
  "os.n.st.revoking": { ko: "게시취소 처리 중", en: "Taking it down" },
  "os.n.st.editRequested": {
    ko: "수정 요청됨(연동 PC 처리 대기)",
    en: "Edit requested (waiting for the linked PC)",
  },
  "os.n.st.editing": { ko: "수정 처리 중", en: "Applying the edit" },
  "os.n.st.revoked": { ko: "게시취소됨(회수)", en: "Taken down (recalled)" },
  "os.n.st.revokePartial": { ko: "일부 회수", en: "Partly recalled" },
  "os.n.scopeMine": { ko: "내 담당 전체", en: "All my students" },
  "os.n.scopeTenant": { ko: "학원 전체", en: "The whole academy" },
  "os.n.loadFail": { ko: "담당 학생을 불러오지 못했습니다", en: "Your students could not be loaded" },
  "os.n.needBody": { ko: "공통 내용을 입력하세요", en: "Write the shared message first" },
  "os.n.needTargets": { ko: "대상 학생을 선택하세요", en: "Pick the students to send to" },
  "os.n.sendFail": { ko: "발송에 실패했습니다", en: "It could not be sent" },
  "os.n.dryRun": {
    ko: "실제 발송이 꺼져 있어 전송하지 않았습니다 — 대상 {n}명(원장 설정에서 'ClassNote 실제 발송'을 켜야 전송).",
    en: "Real sending is off, so nothing went out — {n} students were targeted (turn on real ClassNote sending in the director's settings).",
  },
  "os.n.queued": { ko: "{n}명 발송 대기(연동 PC가 순차 게시)", en: "{n} waiting to send (the linked PC posts them in turn)" },
  "os.n.queuedSkip": { ko: " · 제외 {n}명(발송과목 아님/동명이인)", en: " · {n} left out (not a sent subject, or a duplicate name)" },
  "os.n.editFail": { ko: "수정에 실패했습니다", en: "The edit failed" },
  "os.n.editedPosted": {
    ko: "게시 공지 수정을 요청했습니다 — 연동 PC가 게시글에 반영합니다",
    en: "The edit was requested — the linked PC applies it to the post",
  },
  "os.n.edited": { ko: "공지를 수정했습니다", en: "The notice was edited" },
  "os.n.delConfirm": {
    ko: "이 대기 공지를 삭제할까요? (게시 전이라 학부모에게 가지 않습니다)",
    en: "Delete this waiting notice? (it has not been posted, so nothing reached the parents)",
  },
  "os.n.delFail": { ko: "삭제에 실패했습니다", en: "It could not be deleted" },
  "os.n.deleted": { ko: "대기 공지를 삭제했습니다", en: "The waiting notice was deleted" },
  "os.n.revokeConfirm": {
    ko: "게시된 공지를 학부모 게시판에서 삭제(회수)할까요? 연동 PC가 순차 처리합니다.",
    en: "Take this notice down from the parent board? The linked PC works through them in turn.",
  },
  "os.n.revokeFail": { ko: "게시취소에 실패했습니다", en: "It could not be taken down" },
  "os.n.revoked": {
    ko: "게시취소를 요청했습니다 — 연동 PC가 처리하면 게시판에서 삭제됩니다",
    en: "The take-down was requested — once the linked PC handles it the post is gone",
  },
  "os.n.targets": { ko: "대상 학생", en: "Students to send to" },
  "os.n.scopeToday": { ko: "오늘 수업", en: "Today's lessons" },
  "os.n.poolAll": { ko: "{label} 재원생", en: "Enrolled students · {label}" },
  "os.n.poolToday": { ko: "보이는 반의 재원생", en: "Enrolled students in the classes shown" },
  "os.n.poolTail": { ko: " · 발송 과목(수학 등)만 실제 게시", en: " · only subjects that get sent are actually posted" },
  "os.n.clearAll": { ko: "전체 해제", en: "Unselect all" },
  "os.n.selectAll": { ko: "전체 선택 {n}", en: "Select all {n}" },
  "os.n.loadingAll": { ko: "담당 학생을 불러오는 중…", en: "Loading your students…" },
  "os.n.emptyAll": { ko: "담당 반의 재원생이 없습니다.", en: "There is no enrolled student in your classes." },
  "os.n.emptyToday": { ko: "표시할 학생이 없습니다.", en: "There is no student to show." },
  "os.n.heading": { ko: "학부모 공지", en: "Parent notice" },
  "os.n.headingHint": {
    ko: "선택 학생 학부모의 ClassNote 보드에 공지를 게시합니다 · 수업 보고서와 별개 글로 누적됩니다",
    en: "Posts a notice on the ClassNote board of the selected students' parents · it stacks up separately from the lesson reports",
  },
  "os.n.offA": { ko: "현재 ", en: "Right now " },
  "os.n.offB": { ko: "실제 발송이 꺼져", en: "real sending is off", },
  "os.n.offC": {
    ko: " 있어 전송되지 않습니다(dry-run). 학부모에게 보내려면 원장 설정의 ",
    en: ", so nothing goes out (dry run). To reach the parents, turn on ",
  },
  "os.n.offD": { ko: "ClassNote 실제 발송", en: "real ClassNote sending" },
  "os.n.offE": { ko: "을 켜세요.", en: " in the director's settings." },
  "os.n.bodyLabel": { ko: "공통 내용 (선택 학생 모두에게)", en: "Shared message (goes to every student picked)" },
  "os.n.bodyPh": {
    ko: "예: 안녕하세요 어머님, 다음 주 월요일은 휴강입니다. 교재 p.29까지 풀어 오세요!",
    en: "e.g. Hello, there is no class next Monday. Please work through page 29 of the book!",
  },
  "os.n.indiv": { ko: "학생별 개별 내용 추가 (선택)", en: "Add a message for individual students (optional)" },
  "os.n.indivCount": { ko: " · {n}명 입력함", en: " · {n} written" },
  "os.n.collapse": { ko: "접기", en: "Collapse" },
  "os.n.expand": { ko: "펼치기", en: "Expand" },
  "os.n.indivHintA": { ko: "입력한 학생은 ", en: "For a student you write here, this goes " },
  "os.n.indivHintB": { ko: "공통 내용 뒤에", en: "after the shared message" },
  "os.n.indivHintC": {
    ko: " 이 내용이 덧붙어 발송됩니다. 비우면 공통 내용만 나갑니다.",
    en: ". Leave it empty and only the shared message goes out.",
  },
  "os.n.indivPh": { ko: "이 학생에게만 덧붙일 내용(선택)", en: "Extra message for this student only (optional)" },
  "os.n.confirmCount": { ko: "{n}명", en: "{n} students" },
  "os.n.confirmIndiv": { ko: " (개별 내용 {n}명)", en: " ({n} with their own message)" },
  "os.n.confirmImages": { ko: " · 이미지 {n}장", en: " · {n} images" },
  "os.n.confirmTail": { ko: "의 학부모에게 공지를 발송할까요?", en: " — send the notice to their parents?" },
  "os.n.confirmOff": { ko: " (실제 발송 OFF — 전송 안 됨)", en: " (real sending is OFF — nothing goes out)" },
  "os.n.sending": { ko: "발송 중…", en: "Sending…" },
  "os.n.confirmSend": { ko: "발송 확인", en: "Yes, send it" },
  "os.n.cancel": { ko: "취소", en: "Cancel" },
  "os.n.send": { ko: "ClassNote 공지 발송", en: "Send the ClassNote notice" },
  "os.n.sendCount": { ko: "({n}명)", en: "({n})" },
  "os.n.testTitle": {
    ko: "실 학부모에게 가지 않는 테스트 학생(학원이)에게만 발송해 봅니다",
    en: "Sends only to the test student, which never reaches a real parent",
  },
  "os.n.test": { ko: "테스트 발송(학원이)", en: "Test send" },
  "os.n.history": { ko: "내가 보낸 공지", en: "Notices I sent" },
  "os.n.historyEmpty": { ko: "아직 보낸 공지가 없습니다.", en: "You have not sent a notice yet." },
  "os.n.rowTargets": { ko: " · 대상 {n}명", en: " · {n} recipients" },
  "os.n.links": { ko: "게시글 {n}개:", en: "{n} posts:" },
  "os.n.linkRevoked": { ko: "{name} — 회수됨", en: "{name} — recalled" },
  "os.n.linkNone": { ko: "주소를 못 찾아 링크 없음", en: "No link — the address could not be found" },
  "os.n.linkMore": { ko: "외 {n}명", en: "and {n} more" },
  "os.n.editQueuedTitle": { ko: "발송 전 내용 수정", en: "Edit before it goes out" },
  "os.n.editPostedTitle": { ko: "게시된 글의 내용을 바로 수정", en: "Edit the posted text in place" },
  "os.n.edit": { ko: "수정", en: "Edit" },
  "os.n.delete": { ko: "삭제", en: "Delete" },
  "os.n.revokeTitle": { ko: "학부모 게시판에서 이 공지 글을 삭제(회수)", en: "Take this notice down from the parent board" },
  "os.n.revoke": { ko: "게시취소", en: "Take down" },
  "os.n.save": { ko: "저장", en: "Save" },
  "os.na.label": { ko: "이미지 첨부 (선택 학생 모두에게)", en: "Attach images (they go to every student picked)" },
  "os.na.max": { ko: "이미지는 한 글에 최대 {n}장까지 첨부할 수 있습니다", en: "A post takes at most {n} images" },
  "os.na.trimmed": { ko: "{room}장만 첨부합니다 — 한 글에 최대 {n}장", en: "Only {room} were attached — a post takes at most {n}" },
  "os.na.typeOnly": { ko: "{name} — 이미지(JPG·PNG·WebP)만 첨부할 수 있습니다", en: "{name} — only images (JPG, PNG, WebP) can be attached" },
  "os.na.done": { ko: "이미지 {n}장 첨부", en: "{n} images attached" },
  "os.na.count": { ko: " · {n}장", en: " · {n}" },
  "os.na.add": { ko: "이미지 추가", en: "Add an image" },
  "os.na.hint": { ko: "사진(JPG·PNG·WebP) · 한 글에 최대 {n}장", en: "Photos (JPG, PNG, WebP) · at most {n} per post" },

  // ── 페이저(공용) ────────────────────────────────────────────────
  // 🔴 `components/pagination.tsx`는 **클라 컴포넌트도 import**한다(PAGER_STEP_*·PageStep) —
  //    거기에 server-only 조회를 넣으면 빌드가 깨진다([[#61]]). 그래서 언어는 **prop**으로 받고
  //    기본값이 한국어다(사무실 화면은 한 글자도 안 바뀐다).
  "common.prev": { ko: "이전", en: "Previous" },
  "common.next": { ko: "다음", en: "Next" },
  "common.pageAria": { ko: "페이지 이동", en: "Pagination" },
  "common.pageCount": { ko: " · {n}건", en: " · {n} rows" },

  // ── makeedu 동기화 배지(목록 화면 상단, 공용) ────────────────────
  // ⚠️ `{issue}`는 워커가 쓴 **한국어 사실 문장**이라 번역하지 않는다(특이사항과 같은 축).
  "sync.failed": { ko: "동기화 실패", en: "Sync failed" },
  "sync.ago": { ko: "동기화 {when}", en: "Synced {when}" },
  "sync.issue": { ko: "· 확인 필요", en: "· needs a look" },
  "sync.title": { ko: "makeedu 동기화: {when}", en: "makeedu sync: {when}" },
  "sync.titleRows": { ko: " · 신규 {n}건", en: " · {n} new" },
  "sync.titleIssue": { ko: "\n확인 필요: {issue}", en: "\nNeeds a look: {issue}" },
  "sync.justNow": { ko: "방금 전", en: "just now" },
  "sync.minAgo": { ko: "{n}분 전", en: "{n} min ago" },
  "sync.hourAgo": { ko: "{n}시간 전", en: "{n} h ago" },
  "sync.dayAgo": { ko: "{n}일 전", en: "{n} d ago" },

  // ── 수업목록(/classes) — 목록 화면 ───────────────────────────────
  "cls.title": { ko: "수업목록", en: "Classes" },
  "cls.eyebrow": { ko: "수업 운영", en: "Class operations" },
  "cls.desc": {
    ko: "운영 {active}개 반 · 등록 학생 {seats}명",
    en: "{active} classes running · {seats} students enrolled",
  },
  "cls.stat.total": { ko: "전체 반", en: "In total" },
  "cls.stat.active": { ko: "운영 중", en: "Running now" },
  "cls.stat.seats": { ko: "수강 등록", en: "Class enrollments" },
  "cls.stat.avg": { ko: "반당 평균", en: "Average per class" },
  // 🔴 영어엔 단위가 없다 — `All classes 94`가 곧 문장이라 `개`에 해당하는 낱말을 지어내면
  //    `94 classes classes`가 된다. BigStat은 빈 문자열이면 그 자리를 아예 안 그린다.
  "cls.unit.class": { ko: "개", en: "classes" },
  "cls.unit.people": { ko: "명", en: "" },
  "cls.count.pre": { ko: "결과 ", en: "Found " },
  "cls.count.post": { ko: "개", en: " results" },
  "cls.count.pages": { ko: "{page}/{total} 페이지", en: "page {page} of {total}" },
  "cls.count.q": { ko: "“{q}” 검색", en: "search “{q}”" },
  "cls.empty.title": { ko: "결과 없음", en: "No results" },
  "cls.empty.desc": {
    ko: "폐지·종강된 반은 기본으로 숨깁니다. 상태를 바꾸면 함께 보입니다.",
    en: "Retired and finished classes are hidden by default. Change the status to see them too.",
  },
  "cls.empty.showAll": { ko: "전체 상태로 보기", en: "Show every status" },
  "cls.col.subject": { ko: "과목", en: "Subject" },
  "cls.col.name": { ko: "반 이름", en: "Class name" },
  "cls.col.teacher": { ko: "담임", en: "Homeroom" },
  "cls.col.room": { ko: "강의실", en: "Room" },
  "cls.col.days": { ko: "요일", en: "Days" },
  "cls.col.students": { ko: "학생", en: "Students" },
  "cls.col.status": { ko: "상태", en: "Status" },
  "cls.col.notes": { ko: "메모", en: "Memo" },
  "cls.status.operating": { ko: "운영", en: "Running" },
  "cls.status.ended": { ko: "종강", en: "Finished" },
  "cls.status.retired": { ko: "폐지", en: "Retired" },
  "cls.teacherNone": { ko: "미정", en: "Not assigned" },
  "cls.card.teacherNone": { ko: "담임 미정", en: "No homeroom teacher" },
  "cls.card.roomNone": { ko: "강의실 미정", en: "No room" },
  "cls.card.enrolled": { ko: "재원", en: "Enrolled" },
  "cls.staleTitle": {
    ko: "지금은 운영하지 않는 배치입니다 (운영 기간이 끝났거나 아직 시작 전)",
    en: "This slot is not running right now (its run has ended, or has not started yet)",
  },
  "cls.stale": { ko: "운영 기간 밖", en: "Outside the run" },
  // ⚠️ 요일+시각 — 한국어는 붙여 쓰고(`월14:30`) 영어는 띄운다(`Mon 14:30`).
  "cls.dayAt": { ko: "{dow}{time}", en: "{dow} {time}" },
  "cls.filter.status": { ko: "상태", en: "Status" },
  // v5 §10: 상태 선택지의 "전체"와 보기 축 이름 — 옛 화면엔 축 이름이 없어 사전에도 없었다.
  "cls.filter.all": { ko: "전체", en: "All" },
  "cls.view": { ko: "보기", en: "View" },
  "cls.filter.statusAria": { ko: "상태 필터", en: "Status filter" },
  "cls.filter.subject": { ko: "과목", en: "Subject" },
  "cls.filter.subjectAria": { ko: "과목 필터", en: "Subject filter" },
  "cls.filter.day": { ko: "요일", en: "Days" },
  "cls.filter.dayAria": { ko: "요일 필터", en: "Day filter" },
  "cls.filter.teacher": { ko: "강사", en: "Teacher" },
  "cls.filter.teacherAria": { ko: "강사 필터", en: "Teacher filter" },
  "cls.filter.sort": { ko: "정렬", en: "Sort" },
  "cls.filter.sortAria": { ko: "정렬 기준", en: "Sort by" },
  "cls.filter.searchPh": { ko: "수업명, 강사, 강의실 검색", en: "Search class, teacher, room" },
  // ⚠️ 한국어 쪽 예시(`본원602`)는 실제 강의실 이름이라 영어 문장엔 넣지 않는다(영문 값에 한글 금지).
  "cls.filter.searchTitle": {
    ko: "수업명 · 강사명 · 강의실명으로 찾습니다(예: 본원602)",
    en: "Searches by class name, teacher name and room name",
  },
  "cls.sort.name": { ko: "수업명순", en: "By class name" },
  "cls.sort.students": { ko: "학생수순", en: "By student count" },
  "cls.sort.teacher": { ko: "강사명순", en: "By teacher name" },
  "cls.view.table": { ko: "테이블", en: "Table view" },
  "cls.view.cards": { ko: "카드", en: "Card view" },

  // ── 예정된 변경 배너(반 상세·학생 상세 공용) ─────────────────────
  "sched.title": { ko: "예정된 변경", en: "Scheduled changes" },
  "sched.count": { ko: "{n}건", en: "· {n}" },

  // 시간표 가져오기가 미뤄 둔 **반 자체** 변경(담임·강의실·반 이름) 한 줄 — 반 상세 배너.

  "sched.move": { ko: "{when}부터 {from} → {to} 이동", en: "Moves from {from} to {to} on {when}" },

  "sched.join": { ko: "{when}부터 {name} 합류", en: "Joins {name} on {when}" },

  // 전출은 "그만둠"이 아니라 "다른 반으로 옮겨감"이다 — 같은 말로 쓰면 반 상세가 거짓말을 한다.

  "sched.transferOut": { ko: "{when}에 {name}에서 다른 반으로 이동", en: "Leaves {name} for another class on {when}" },

  "sched.leave": { ko: "{when}에 {name} 수강 종료", en: "Enrolment in {name} ends on {when}" },

  "sched.classChange": { ko: "{md}부터 {what} {from} → {to}", en: "From {md}, {what}: {from} → {to}" },

  // ── 수업 상세(/classes/[id]) ─────────────────────────────────────
  "cls.d.title": { ko: "수업 상세", en: "Class detail" },
  // 반 상세 머리 → 성적관리 JJ실을 이 반으로 좁혀 연다(2026-09-11, jj-class-link.tsx).
  "cls.d.jjStudy": { ko: "인재원 학습", en: "JJ Study" },
  "cls.d.back": { ko: "수업목록으로", en: "Back to the class list" },
  "cls.d.eyebrow": { ko: "수업 · 반", en: "This class" },
  "cls.d.endedAt": { ko: "종강 {date}", en: "Finished {date}" },
  // 🔴 수는 `num`(고정폭 숫자) 안에 남겨야 해서 앞·뒤 조각으로 나눈다 — 조각이 아니라 **한 문장의 양끝**이다.
  "cls.d.enrolledPre": { ko: "· 재원생 ", en: "· " },
  "cls.d.enrolledPost": { ko: "명", en: " enrolled" },
  // 인수인계 후보 목록의 힌트 — 과목 라벨은 학원설정에서 오고 이 둘만 문구다.

  "cls.d.sameSubject": { ko: "이 반 과목", en: "Same subject" },

  "cls.d.noSubject": { ko: "과목 미지정", en: "No subject set" },

  "cls.d.edit": { ko: "반 수정", en: "Edit this class" },
  "cls.d.sheetWin": { ko: "영어 강사 시트", en: "English class sheet" },
  "cls.d.attendance": { ko: "오늘 출석 입력", en: "Take today's attendance" },
  "cls.d.attendanceWin": { ko: "출석 입력", en: "Attendance entry" },
  "cls.d.schedTitle": { ko: "시간표 예약", en: "Timetable change scheduled" },
  "cls.d.schedHint": {
    ko: "그날 자동으로 바뀝니다. 되돌리려면 시간표 화면의 적용 예정 배지에서 취소하세요.",
    en: "It changes by itself on that day. To undo it, cancel from the scheduled badge on the timetable screen.",
  },
  "cls.d.info": { ko: "반 정보", en: "About this class" },
  "cls.d.timetable": { ko: "시간표", en: "Timetable" },
  "cls.d.att30": { ko: "최근 30일 출결", en: "Attendance, last 30 days" },
  "cls.d.rate": { ko: "출석률", en: "Attendance rate" },
  "cls.d.records": { ko: "총 건수", en: "In all" },
  // ⚠️ 단위 `건`은 영어에서 라벨(`Records`)이 이미 말한다 — 낱말을 지어내면 `12 records records`가 된다.
  "cls.d.unitCount": { ko: "건", en: "entries" },
  "cls.d.roster": { ko: "수강 중인 학생", en: "Students in this class" },
  "cls.d.rosterCount": { ko: "{n}명", en: "{n} students" },
  "cls.d.upcomingCount": { ko: "· 예정 {n}", en: "· {n} upcoming" },
  "cls.d.rosterEmpty": { ko: "활성 재원생이 없습니다", en: "No active student in this class" },
  "cls.d.fromDate": { ko: "{md}부터", en: "from {md}" },
  "cls.d.allDays": { ko: "모두", en: "Every day" },
  "cls.d.onlyDays": { ko: "{days}만", en: "{days} only" },
  "cls.d.toNow": { ko: "~ 현재", en: "~ now" },
  "cls.d.onHold": { ko: "휴원", en: "On hold" },

  // ── 시간표 요약 카드 ─────────────────────────────────────────────
  "cls.sch.none": { ko: "등록된 시간표가 없습니다", en: "No timetable has been entered" },
  "cls.sch.notStarted": { ko: "아직 시작하지 않은 반입니다", en: "This class has not started yet" },
  "cls.sch.sessions": { ko: " · 주 {n}회", en: " · {n}× a week" },
  "cls.sch.weekly": { ko: " · 주 {v}", en: " · {v} a week" },
  "cls.sch.startsFrom": { ko: "{md}부터", en: "From {md}" },
  "cls.sch.startsSoon": { ko: "시작 예정", en: "Starting soon" },
  "cls.sch.pastHidden": { ko: "지난 배치 {n}개는 숨김", en: "{n} past slots are hidden" },
  "cls.sch.pastTitle": {
    ko: "운영 종료일이 지난 시간표 행입니다. 기록으로 남아 있고 화면·편집에서는 빠집니다.",
    en: "These slots ran out before today. They stay on record but are left out of this screen and of editing.",
  },
  // 주당 시수 — 붙은 교시를 합친 뒤의 길이라 `주 1시간 40분`처럼 읽힌다.
  "cls.sch.min": { ko: "{m}분", en: "{m} min" },
  "cls.sch.hour": { ko: "{h}시간", en: "{h} h" },
  "cls.sch.hourMin": { ko: "{h}시간 {m}분", en: "{h} h {m} min" },

  // ── 레벨 변경(영어 레벨반 전용) ──────────────────────────────────
  "cls.lv.label": { ko: "레벨", en: "Level code" },
  "cls.lv.number": { ko: "숫자", en: "Number" },
  "cls.lv.level": { ko: "레벨", en: "Tier" },
  "cls.lv.numberUp": { ko: "숫자 올리기 (예: DP3 → DP4)", en: "Move the number up (e.g. DP3 to DP4)" },
  "cls.lv.numberDown": { ko: "숫자 내리기 (예: DP4 → DP3)", en: "Move the number down (e.g. DP4 to DP3)" },
  "cls.lv.classUp": { ko: "레벨 올리기 (예: DP3 → PL1)", en: "Move the tier up (e.g. DP3 to PL1)" },
  "cls.lv.classDown": { ko: "레벨 내리기 (예: PL1 → DP3)", en: "Move the tier down (e.g. PL1 to DP3)" },

  // ── 강사 인수인계(담임이 영구히 바뀐다) ──────────────────────────
  "cls.ho.open": { ko: "강사 인수인계", en: "Hand the class over" },
  "cls.ho.dialogTitle": { ko: "강사 인수인계 예약", en: "Schedule a handover" },
  // 🔴 이름과 버튼 이름이 문장 가운데서 **강조**된다 — 한 키로 합치면 그 서식이 사라진다.
  //    가운데 강조 조각은 버튼과 **같은 키**(`cls.ho.applyNow`)를 쓴다(둘이 갈리면 안내가 거짓이 된다).
  "cls.ho.introA": { ko: "현재 담임 ", en: "The homeroom teacher is now " },
  "cls.ho.introB": {
    ko: " → 새 담임으로 교체를 예약합니다. 적용일에 ",
    en: ". This books a change to a new one. On that day, press ",
  },
  "cls.ho.introC": { ko: " 버튼으로 반영됩니다.", en: " to make it real." },
  "cls.ho.newTeacher": { ko: "새 담임 *", en: "New homeroom teacher *" },
  "cls.ho.pickTeacher": { ko: "강사 선택", en: "Pick a teacher" },
  "cls.ho.searchName": { ko: "이름으로 검색...", en: "Search by name..." },
  "cls.ho.newTeacherAria": { ko: "새 담임 강사", en: "New homeroom teacher" },
  "cls.ho.poolHint": {
    ko: "이 반 과목 담당 강사가 위에 표시됩니다. 신입·타 과목 강사도 이름으로 검색해 선택할 수 있어요.",
    en: "Teachers of this class's subject come first. You can also search by name for a new teacher or one from another subject.",
  },
  "cls.ho.effectiveDate": { ko: "적용일 *", en: "Takes effect on *" },
  "cls.ho.reason": { ko: "사유 메모", en: "Reason note" },
  "cls.ho.optional": { ko: "선택", en: "Optional" },
  "cls.ho.cancel": { ko: "취소", en: "Cancel" },
  "cls.ho.book": { ko: "예약", en: "Book it" },
  "cls.ho.close": { ko: "닫기", en: "Close" },
  "cls.ho.bannerTitle": { ko: "강사 인수인계 예약됨", en: "Handover booked" },
  "cls.ho.due": { ko: "적용일 도달", en: "Due today" },
  "cls.ho.effectiveOn": { ko: "· 적용일 {date}", en: "· takes effect {date}" },
  "cls.ho.applyNow": { ko: "지금 적용", en: "Apply now" },
  "cls.ho.cancelBooking": { ko: "예약 취소", en: "Cancel the booking" },
  "cls.ho.teacherNone": { ko: "미정", en: "Nobody yet" },

  // ── 임시 위임(담임은 그대로, 이 기간만 대신) ─────────────────────
  "cls.dg.open": { ko: "임시 위임", en: "Cover for a while" },
  "cls.dg.dialogTitle": { ko: "임시 위임", en: "Cover for a while" },
  "cls.dg.introA": { ko: " 반을 이 기간에만 다른 선생님이 대신 맡습니다. 담임(", en: " is covered by another teacher for this stretch only. The homeroom teacher (" },
  "cls.dg.introB": { ko: ")은", en: ") stays" },
  "cls.dg.introC": { ko: " 그대로", en: " the same" },
  "cls.dg.introD": { ko: "이고, 기간이 지나면 저절로 원래대로 돌아옵니다.", en: ", and everything goes back on its own once the stretch is over." },
  "cls.dg.delegate": { ko: "대신 맡을 선생님 *", en: "Teacher covering *" },
  "cls.dg.pickTeacher": { ko: "선생님 선택", en: "Pick someone to cover" },
  "cls.dg.delegateAria": { ko: "대신 맡을 선생님", en: "Teacher covering" },
  "cls.dg.hintA": { ko: "선택한 선생님의 원스크린 반 목록에 이 반이 ", en: "This class shows up on that teacher's onescreen list as " },
  "cls.dg.hintB": { ko: "위임", en: "covered" },
  "cls.dg.hintC": {
    ko: "으로 뜹니다. 표 모드·임시저장·발송이 자기 반과 똑같이 동작합니다.",
    en: ". The grid, the drafts and sending all work exactly as they do for their own classes.",
  },
  "cls.dg.fromDate": { ko: "시작일 *", en: "First day *" },
  "cls.dg.toDate": { ko: "종료일 *", en: "Last day *" },
  "cls.dg.maxHintA": { ko: "하루만 맡기면 두 날짜를 같게 둡니다(기본). 최대 {n}일 — 더 길면 담임을 바꾸는", en: "For a single day, leave both dates the same (that is the default). Up to {n} days — anything longer is a" },
  "cls.dg.maxHintB": { ko: " 강사 인수인계", en: " handover" },
  "cls.dg.maxHintC": { ko: "가 맞습니다.", en: ", which changes the homeroom teacher." },
  "cls.dg.submit": { ko: "위임", en: "Hand it over" },
  "cls.dg.bannerTitle": { ko: "임시 위임 {n}건 — 담임은 그대로입니다", en: "{n} covering the class — the homeroom teacher is unchanged" },
  "cls.dg.nameNone": { ko: "이름 없음", en: "No name" },
  "cls.dg.active": { ko: "진행 중", en: "Under way" },
  "cls.dg.upcoming": { ko: "예정", en: "Booked" },
  "cls.dg.ended": { ko: "종료", en: "Over" },
  "cls.dg.revoke": { ko: "해제", en: "Release" },
  // 기간 라벨·검증 — 서버 액션도 같은 함수를 쓰므로 **인자를 안 주면 한국어**다.
  "cls.dg.day": { ko: "{m}월 {d}일", en: "{m}/{d}" },
  "cls.dg.range": { ko: "{from} ~ {to}", en: "{from} – {to}" },
  "cls.dg.errDate": { ko: "기간을 날짜로 선택해주세요", en: "Please pick the dates" },
  "cls.dg.errOrder": { ko: "종료일이 시작일보다 빠릅니다", en: "The last day comes before the first day" },
  "cls.dg.errTooLong": {
    ko: "위임은 최대 {n}일까지입니다 — 더 길게 맡기려면 '강사 인수인계'를 쓰세요",
    en: "Covering runs at most {n} days — for anything longer, use the handover instead",
  },

  // ── 이력 ─────────────────────────────────────────────────────────
  // ⚠️ 줄 내용(`title`·`detail`·`actor`)은 감사로그에서 온 **한국어 사실 문장**이라 번역하지 않는다.
  "cls.hist.title": { ko: "이력", en: "History" },
  "cls.hist.hint": {
    ko: "수업 배치·담당·강의실·학생 배정이 바뀐 기록입니다. 시간표에서 그 주를 열면 당시 배치가 그대로 보입니다.",
    en: "A record of changes to the slots, the teacher, the room and the roster. Open that week on the timetable to see the layout as it was.",
  },
  "cls.hist.fromAria": { ko: "이력 시작일", en: "History from" },
  "cls.hist.toAria": { ko: "이력 종료일", en: "History to" },
  "cls.hist.clear": { ko: "전체", en: "All dates" },
  "cls.hist.empty": {
    ko: "남아 있는 변경 기록이 없습니다. 2026-08-04 이전의 담당·강의실 변경은 기록 자체가 남지 않아 되살릴 수 없고, 이후의 변경부터 이 자리에 쌓입니다.",
    en: "There is no change on record. Changes to the teacher or the room before 2026-08-04 were never written down and cannot be recovered; everything after that lands here.",
  },
  "cls.hist.emptyRange": {
    ko: "그 기간에는 기록이 없습니다. 위 날짜를 지우면 전체가 보입니다.",
    en: "Nothing in that stretch. Clear the dates above to see everything.",
  },
  "cls.hist.toNow": { ko: "~ 현재", en: "~ now" },
  "cls.hist.pageAria": { ko: "이력 페이지 이동", en: "History pagination" },
  "cls.hist.src.schedule": { ko: "배치", en: "Slot" },
  "cls.hist.src.audit": { ko: "기록", en: "Log" },
  "cls.hist.src.delegation": { ko: "위임", en: "Cover" },
  "cls.hist.src.enrollment": { ko: "학생", en: "Roster" },
  "cls.hist.src.report": { ko: "보고서", en: "Report" },

  // ── 분리등원 요일 인라인 수정 ────────────────────────────────────
  "cls.ad.editTitle": { ko: "터치 또는 더블클릭하여 등원 요일 수정", en: "Tap or double-click to change attendance days" },
  "cls.ad.needOne": { ko: "최소 한 요일", en: "Pick at least one day" },
  "cls.ad.save": { ko: "저장", en: "Save" },
  "cls.ad.cancel": { ko: "취소", en: "Cancel" },

} as const satisfies Record<string, { ko: string; en: string }>;

export type SheetDictKey = keyof typeof SHEET_DICT;

/**
 * 사전 조회. **`en`이 비었으면 한글로 폴백**한다(빈 문자열·키 노출 금지).
 * 🔴 키가 아예 없으면(타입을 우회해 들어온 값) 키를 화면에 내지 않고 빈 문자열 대신 키를 던지지도
 *    않는다 — 타입이 막고 있으므로 런타임에는 도달할 수 없고, 그래도 뚫리면 한글 폴백이 없어 키를 낸다.
 *    그 편이 조용한 빈칸보다 고치기 쉽다(개발 중에만 보인다).
 */
export function sheetT(lang: SheetLang, key: SheetDictKey): string {
  const entry = SHEET_DICT[key] as { ko: string; en: string } | undefined;
  if (!entry) return key;
  const v = lang === "en" ? entry.en : entry.ko;
  return v || entry.ko;
}

/**
 * 메뉴 키(`MenuKey`) → 그 메뉴 이름. 미니셸 **헤더의 현재 메뉴명**과 '내 메뉴' 항목이 같은 표를 읽는다.
 *
 * 🔴 앱 전역 네비 표([`navigation.ts`](@/lib/navigation))의 `label`을 **고치지 않는다** — 그 표는 관리자
 *    사이드바·검색 팰릿·창 제목이 함께 쓰고, 관리자뷰는 한국어 고정이다(원장 2026-09-03). 여기서는
 *    **강사 미니셸이 그릴 때만** 이름을 갈아 끼운다.
 * ⚠️ 사전에 없는 메뉴(강사에게 안 열리는 메뉴)는 `null` — 호출부가 원래 한국어 라벨로 폴백한다
 *    (지어내지 않는다·빈 칸도 만들지 않는다).
 */
export function sheetMenuLabel(menuKey: string, lang: SheetLang): string | null {
  const key = `menu.item.${menuKey}`;
  // ⚠️ 먼저 **실제로 있는 키인지** 보고 그 다음에 좁힌다(캐스팅해 놓고 확인하면 없는 키가 타입만 통과한다).
  if (!Object.hasOwn(SHEET_DICT, key)) return null;
  return sheetT(lang, key as SheetDictKey);
}

/** 호출부에서 `t("...")`로 쓰기 위한 바인딩(서버·클라 공용). */
export function sheetTranslator(lang: SheetLang): (key: SheetDictKey) => string {
  return (key) => sheetT(lang, key);
}

/**
 * **수를 끼우는 문구** — `{이름}` 자리를 채운다.
 *
 * 🔴 **조각 세 개를 이어 붙이지 말 것**(`앞 + n + 뒤`) — 한국어는 수 뒤에 단위가 오고(`미입력 4명`)
 *    영어는 앞에 온다(`4 unmarked`). 조각으로 두면 영어 어순이 무너진다(`Today's classes 3 —`를
 *    그렇게 만들었다가 고쳤다). 문장 **전체**를 사전에 넣고 자리만 뚫는다.
 * ⚠️ 값은 문자열로 그대로 박는다(이스케이프 없음) — 넣는 것은 우리가 만든 수·이름뿐이고 JSX가
 *    렌더하므로 XSS 경로가 아니다.
 * ⚠️ 없는 자리는 그대로 남는다(빈칸으로 지우지 않는다) — 개발 중에 눈에 띄어야 고친다.
 */
export function sheetTf(
  lang: SheetLang,
  key: SheetDictKey,
  params: Record<string, string | number>,
): string {
  let out = sheetT(lang, key);
  for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// ── 날짜 표기 ────────────────────────────────────────────────────────
/**
 * 요일 한 글자 — 주간 시트의 요일 알약.
 * ⚠️ 영어는 세 글자(`Mon`)다. 한 글자(`M`)로 줄이면 화·수(T/W)와 토·일(S/S)이 구분되지 않는다.
 */
const DOW_LABEL: Record<SheetLang, Record<string, string>> = {
  ko: { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" },
  en: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
};

export function sheetDowLabel(dow: string, lang: SheetLang): string {
  return DOW_LABEL[lang][dow] ?? DOW_LABEL.ko[dow] ?? dow;
}

/** 자바스크립트 요일 번호(0=일 … 6=토) → 같은 표. 달력·진도표가 `Date.getDay()`를 그대로 쓴다. */
const DOW_BY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function sheetDowLabelByIndex(day: number, lang: SheetLang): string {
  return sheetDowLabel(DOW_BY_INDEX[((day % 7) + 7) % 7], lang);
}

/**
 * 월 라벨 — 한국어는 **호출부가 만든 값을 그대로** 쓴다(앱 전역 `monthLabel`이 정본이고, 여기서
 * 한글판을 다시 만들면 같은 달이 화면마다 다르게 적힌다 — 주간 라벨과 같은 규약).
 * 영어는 `September 2026`.
 */
export function sheetMonthLabel(month: string, koLabel: string, lang: SheetLang): string {
  if (lang !== "en") return koLabel;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return koLabel;
  return `${EN_MONTHS_FULL[m - 1]} ${y}`;
}

const EN_MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * `YYYY-MM-DD` → 요일까지 붙은 날짜 표기(영어). 한국어는 앱 전역 `formatKoreanDate`가 정본이라
 * 호출부가 그대로 쓴다 — 여기서 한글판을 다시 만들면 같은 날짜가 화면마다 다르게 적힌다.
 *
 * ⚠️ `new Date("YYYY-MM-DD")`는 UTC 파싱이라 KST에서 하루 밀린다 → `Date.UTC`로 만들고 UTC로 읽는다
 *    (앱 전역 date-kst 규약과 같다).
 */
export function sheetDateLabelEn(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay(): 0=일 … 6=토 → 월요일 기준 인덱스로.
  const dow = EN_DOWS[(dt.getUTCDay() + 6) % 7];
  return `${dow}, ${EN_MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * 화면에 쓸 날짜 라벨 — 한국어는 호출부가 준 것(`formatKoreanDate`) 그대로, 영어는 다시 만든다.
 * 🔴 여기서 한글판을 만들지 않는다 — 같은 날짜가 화면마다 다르게 적히지 않게 정본은 앱 전역
 *    [`formatKoreanDate`](@/lib/date-kst) 하나다(주·월 라벨과 같은 규약).
 */
export function sheetDateLabel(ymd: string, koLabel: string, lang: SheetLang): string {
  return lang === "en" ? sheetDateLabelEn(ymd) : koLabel;
}

/**
 * 주 라벨(영어) — 월요일 하나로 만든다. 한국어(`weekLabel`)는 "N월 M주차 (D일~D일)"인데, 영어에는
 * '몇 주차'라는 관용이 약해 **기간을 그대로** 적는다(`Sep 1 – Sep 7, 2026`).
 *
 * ⚠️ 서버가 내려주는 `weekLabel`을 바꾸지 않는다 — 그 문자열은 인쇄·다른 화면도 쓰고, 여기선
 *    같은 재료(`weekMonday`)로 표기만 다시 만든다(왕복 0·서버 변경 0).
 */
export function sheetWeekLabelEn(monday: string): string {
  const [y, m, d] = monday.split("-").map(Number);
  if (!y || !m || !d) return monday;
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  const sM = EN_MONTHS[start.getUTCMonth()];
  const eM = EN_MONTHS[end.getUTCMonth()];
  const head = `${sM} ${start.getUTCDate()}`;
  const tail = sM === eM ? `${end.getUTCDate()}` : `${eM} ${end.getUTCDate()}`;
  return `${head} – ${tail}, ${end.getUTCFullYear()}`;
}

/** 화면에 쓸 주 라벨 — 한국어는 서버가 준 것 그대로, 영어는 월요일에서 다시 만든다. */
export function sheetWeekLabel(monday: string, koLabel: string, lang: SheetLang): string {
  return lang === "en" ? sheetWeekLabelEn(monday) : koLabel;
}
