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
  "att.period.disabledTeacher": {
    ko: "강사 전체 보기는 반마다 세션이 달라 달력월로 표시합니다",
    en: "The all-classes view spans classes with different sessions, so it shows calendar months",
  },
  "att.period.disabledNoClass": { ko: "반을 고르면 세션으로 볼 수 있습니다", en: "Pick a class to switch to sessions" },
  "att.period.aria": { ko: "날짜축 전환", en: "Switch date axis" },
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
  "att.hub.day": { ko: "하루", en: "Daily" },
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
  "att.help.a": { ko: "총 ", en: "Recorded " },
  "att.help.b": { ko: "회 기록 · 칸을 고르고 ", en: " in total · pick a cell and type a " },
  "att.help.number": { ko: "숫자", en: "number" },
  "att.help.c": {
    ko: "를 치세요(0=결석, 1·1.5·2=출석 시수) · 방향키·Tab·Enter 이동 · Shift로 범위 · Ctrl+C/V · Ctrl+Z · 우하단 손잡이를 끌면 채우기 · ",
    en: " (0 = absent, 1·1.5·2 = sessions present) · arrows·Tab·Enter to move · Shift for a range · Ctrl+C/V · Ctrl+Z · drag the bottom-right handle to fill · ",
  },
  "att.help.d": { ko: "지각·조퇴·보강·메모는 ", en: "for late, early leave, makeup and notes, " },
  "att.help.rightClick": { ko: "우클릭", en: "right-click" },
  "att.help.e": {
    ko: "(7일 지난 칸도 메모는 고칠 수 있습니다)",
    en: "(notes stay editable even on cells older than 7 days)",
  },
  "att.legend": { ko: "범례", en: "Legend" },
  "att.legend.classDay": { ko: "등원요일", en: "Class day" },
  "att.legend.off": { ko: "주말·휴일", en: "Weekend · holiday" },
  "att.row.thisClass": { ko: "이 반", en: "this class" },
  "att.row.attendDows": { ko: "등원 {dows}", en: "Class days {dows}" },
  "att.row.noTierTitle": {
    ko: "{name} — 단가(수업 티어) 미지정이라 정산액에서 빠져 있습니다. 수강의 티어를 지정하면 계산에 들어갑니다",
    en: "{name} — no rate tier is set, so this student is left out of the pay figure. Set the tier on the enrolment to include them",
  },
  "att.row.noTier": { ko: "단가", en: "No rate" },
  "att.row.tierTitle": { ko: "단가 티어 {tier}", en: "Rate tier {tier}" },
  "att.cell.nPeriods": { ko: "{n}교시 · {breakdown}", en: "{n} periods · {breakdown}" },
  "att.cell.alsoWrites": {
    ko: " · 이 칸을 고치면 이 교시들도 함께 바뀝니다",
    en: " · changing this cell changes those periods too",
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
  "att.stat.enrolled": { ko: "등록", en: "Enrolled" },
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
  "att.pop.unitsAria": { ko: "시수", en: "Sessions" },
  "att.pop.unitsTitle": {
    ko: "정규 수업 1회 = 1. 보강 연장 1.5·2, 부분 출석 0.5 등",
    en: "One regular class = 1. Use 1.5 or 2 for extended makeups, 0.5 for a partial attendance, and so on",
  },
  "att.pop.pickFirst": { ko: "상태를 먼저 선택하세요", en: "Pick a status first" },
  "att.pop.save": { ko: "저장", en: "Save" },
  "att.pop.clear": { ko: "지우기", en: "Clear" },
  "att.pop.sharedWarn.a": {
    ko: "고치면 같은 날 다른 교시 기록 {n}건(다른 선생님·자리 JJ·랩실)도 함께 바뀝니다. 지우기는 여기서 못 합니다 — ",
    en: "Changing this also changes {n} records in other periods that day (other teachers, the JJ and Lab seats). Clearing is not possible here — use ",
  },
  "att.pop.sharedWarn.b": { ko: "반별 보기에서 지우세요", en: "the class view to clear it" },
  "att.grid.sharedBlock": {
    ko: "이 칸엔 다른 교시 기록 {n}건(다른 선생님·자리 JJ·랩실)이 함께 있어 여기서 지우면 그것까지 지워집니다 — 반별 보기에서 지우세요",
    en: "This cell also holds {n} records from other periods (other teachers, the JJ and Lab seats), so clearing here would clear those too — clear it in the class view",
  },
  "att.grid.sharedNotice": {
    ko: "같은 날 다른 교시 기록 {n}건(다른 선생님·자리)도 함께 바뀝니다",
    en: "{n} records in other periods that day (other teachers, the seats) change too",
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
    ko: "{n}칸은 같은 날 다른 교시 기록(다른 선생님·자리)도 함께 바뀌었습니다",
    en: "{n} cells also changed other periods' records that day (other teachers, the seats)",
  },
  "att.grid.clear.sharedMaybe": {
    ko: "{n}칸은 같은 날 다른 교시 기록(다른 선생님·자리)도 함께 바뀌었을 수 있습니다",
    en: "{n} cells may also have changed other periods' records that day (other teachers, the seats)",
  },
  "att.search.totalsNote": { ko: "숫자도 검색 기준", en: "totals follow the search" },
  "att.search.count": { ko: "검색 {n}명", en: "{n} found" },
  "att.search.clear": { ko: "검색 지우기", en: "Clear search" },

  "att.search.none": {
    ko: "‘{query}’과 맞는 학생이 {where}에 없습니다 — 검색어를 지우면 전체가 다시 보입니다.",
    en: "No student matches ‘{query}’ in {where} — clear the search to see everyone again.",
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
