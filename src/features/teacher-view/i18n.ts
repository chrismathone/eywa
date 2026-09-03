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
 * - **절대 번역하지 않는다**: 학생 이름 · 반 이름 · 교재명 · 진도 · 특이사항 · 담임 이름 · 학교명 ·
 *   프로그램 이름(`EiE`·`인재원 영어`) — **사람이 입력한 사실**이다. 옮기면 그 자리에서 사실이 바뀌고,
 *   한국인 강사와 원어민이 같은 반을 다른 이름으로 부르게 된다.
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
 * 🔴 **쓰지 않을 키를 미리 넣지 말 것**(학원설정의 write-only-orphan과 같은 함정) — v1은 상단 바·
 *    네비·랜딩 프레임까지다. 시트 본문(로스터 열 머리·계획 표·월간 표)은 아직 한국어이고, 넓힐 땐
 *    **배선과 같은 푸시에서** 키를 더한다.
 */
export const SHEET_DICT = {
  // ── 언어 스위치 자체('내 메뉴' 드롭다운 안) ───────────────────────
  "lang.label": { ko: "언어", en: "Language" },
  "lang.title": {
    ko: "강사 화면의 언어 — 내 계정에 저장되어 다른 PC에서도 같은 언어로 열립니다. 학생 이름·반 이름·교재·진도 등 입력된 내용은 번역하지 않습니다.",
    en: "Language for your teacher screens. Saved to your account, so it opens the same way on any PC. Student names, class names, books and lesson notes are never translated.",
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
  "menu.item.calendar": { ko: "캘린더", en: "Calendar" },
  "menu.item.approvals": { ko: "전자결재", en: "Approvals" },
  "menu.item.class_review": { ko: "수업 평가", en: "Class review" },
  "menu.item.documents": { ko: "데이터베이스", en: "Documents" },

  // ── 면 전환(주간 | 달력 | 진도표 | 계획) ──────────────────────────
  "face.week": { ko: "주간", en: "Weekly" },
  "face.cal": { ko: "달력", en: "Calendar" },
  "face.rail": { ko: "진도표", en: "Progress" },
  "face.mp": { ko: "계획(MP)", en: "Plan (MP)" },
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
  "chrome.list": { ko: "목록", en: "Classes" },
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
  "toolbar.attendance": { ko: "출석부", en: "Attendance" },
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

  // ── '오늘' 면 ─────────────────────────────────────────────────────
  // ⚠️ `머리 + 개수 + 꼬리`로 이어진다 — 한국어는 수 뒤에 단위(`개`)가 오고 영어는 앞에 오지 않으므로,
  //    단위는 **꼬리**가 들고 있어야 양쪽 어순이 맞는다(`오늘 수업 3개 · …` / `Today 3 classes — …`).
  "today.desc.today": { ko: "오늘 수업", en: "Today" },
  "today.desc.day": { ko: "이 날 수업", en: "This day" },
  "today.desc.tail": {
    ko: "개 · 계획·출결·보고서를 한 화면에서",
    en: " classes — plans, attendance and reports on one screen",
  },
  "today.embed.today": { ko: "오늘", en: "Today" },
  "today.weekHint.before": { ko: "전체 반에 대한 내용을 보려면", en: "To see every class, open" },
  "today.weekHint.link": { ko: "‘주간 시트’", en: "“Weekly sheet”" },
  "today.weekHint.after": { ko: "에서 볼 수 있습니다.", en: "." },
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
  "strip.fillAll": { ko: "전원 출석", en: "Mark all present" },
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
  "presence.more": { ko: " 외 {n}명", en: " +{n}" },
  // ⚠️ 영어는 **`is/are`를 쓰지 않는다** — 이름이 하나일 수도 여럿일 수도 있어 어느 쪽을 골라도
  //    절반은 틀린 문장이 된다(한국어 `님이`는 수와 무관해 문제가 없다). 대시로 끊어 수를 안 드러낸다.
  "presence.title": {
    ko: "{names}님이 지금 이 항목을 수정 중입니다",
    en: "{names} — editing this item right now",
  },

  // ── 하루 일괄 입력 툴바 ───────────────────────────────────────────
  "bulk.attendance": { ko: "일괄 출석", en: "Mark all present" },
  "bulk.attitude": { ko: "일괄 태도", en: "Set attitude" },
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
  "nav.face.week": { ko: "주간 시트", en: "Weekly sheet" },
  "nav.face.room": { ko: "305 · JJ실", en: "305 · JJ room" },
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
