/**
 * 강사 시트 **화면 언어**(한국어 / English) — 사전 한 벌 + 순수 해석 함수.
 *
 * 원장 2026-09-03: *"강사뷰 화면을 영어/한글 전환할 수 있도록 원어민 전용뷰 세팅 (영어강사 기준)"*.
 * 원어민 강사(실측 injaewon 활성 12명 중 `KRISTINE DRIVER`·`Florence Park` 2명)는 영어 전담이라
 * 강사 홈이 ECS로 착지하는데([`teacher-home-rule.ts`](@/lib/auth/teacher-home-rule)), 그 화면의
 * 안내·상태·버튼이 전부 한글이라 **자기 반 시트를 읽지 못한 채** 써 왔다.
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
 * 사전에 없거나 창밖(MCS·다른 메뉴)에서 읽힐 때의 값 = **한국어**.
 *
 * 🔴 이 기본값을 `en`으로 돌리지 말 것 — `SheetClassPicker`는 MCS(수학 시트)도 쓰는 공용 조각이라
 *    ECS 밖에서는 provider 없이 이 값으로 떨어진다. 여기가 `en`이면 수학 시트 상단이 영어가 된다.
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

/** 저장된 선택 → 실제 언어. 고른 값이 있으면 그것, 없으면 이름에서 도출. */
export function resolveSheetLang(
  stored: unknown,
  displayName: string | null | undefined,
): SheetLang {
  return parseSheetLang(stored) ?? defaultSheetLangFor(displayName);
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
  // ── 언어 스위치 자체 ───────────────────────────────────────────────
  "lang.title": {
    ko: "이 화면(영어 강사 시트)의 언어 — 내 계정에 저장되어 다른 PC에서도 같은 언어로 열립니다. 학생 이름·반 이름·교재·진도 등 입력된 내용은 번역하지 않습니다.",
    en: "Language for the English teacher sheet. Saved to your account, so it opens the same way on any PC. Student names, class names, books and lesson notes are never translated.",
  },
  "lang.aria": { ko: "화면 언어 선택", en: "Choose display language" },

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

/** 호출부에서 `t("...")`로 쓰기 위한 바인딩(서버·클라 공용). */
export function sheetTranslator(lang: SheetLang): (key: SheetDictKey) => string {
  return (key) => sheetT(lang, key);
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
