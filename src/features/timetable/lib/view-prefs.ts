// 시간표 '뷰 설정'(계정 귀속) — 순수 모듈. 저장은 users.ui_prefs jsonb(0146a).
//
// ⚠️ 학제/학년 필터는 **학생 단위**로 건다. 반 단위로 걸면 안 된다 —
// 실측(2026-07-23): 활성 반 106개 중 **9개가 학제 혼합**이다(개별반은 학년이 섞인다:
// '고등M 개별 TP4E' 10명이 중·고 혼재, '초등M 개별 CR1D' 8명이 초·중 혼재…).
// 반을 통째로 켜고 끄면 그 9개 반이 사라지거나, 반은 남고 남은 학생이 조용히 증발한다.
//
// 규칙 3줄:
//  ① 학생을 학년으로 거른다.
//  ② 보이는 학생이 **1명이라도 있으면 반은 남긴다**(혼합 반 보존).
//  ③ 원래 학생이 0명인 반은 필터와 무관하게 유지 — 필터는 '학생을 숨기는 것'이지 '빈 반을 숨기는
//     것'이 아니다. 안 그러면 명단 없는 반이 필터를 켜는 순간 시간표에서 사라져 구멍이 난다.
//
// ⚠️ 학년을 모르는 학생(grade null)은 **항상 보인다**(fail-open). 필터에 안 걸린다고 숨기면
// 학년 미입력 학생이 시간표에서 통째로 증발한다 — 조용한 소실보다 한 명 더 보이는 쪽이 안전하다.

import { mergeTeacherOrderPref, parseTeacherOrderPref, type TeacherOrderPref } from "./teacher-order";
import { isPreschoolGrade, PRESCHOOL_LABEL } from "@/lib/format/school-grade";
import { DEFAULT_UI_FONT_SIZE, UI_FONT_SIZES, type UiFontSize } from "@/lib/ui-prefs/font-size";
import { mergeEditorViewPref, parseEditorViewPref, type EditorViewPref } from './editor-view-prefs';
import {
  normalizeEnglishTrackFilter,
  type EnglishTrackFilter,
} from "@/features/classes/english-track";

/** 학년 목록은 학원설정(operations.gradeLevels)이 단일 소스 — 여기에 학년을 하드코딩하지 말 것. */
export type TimetableViewPrefs = {
  /**
   * 보이는 학년 목록. `null` = 전체(필터 없음).
   * 빈 배열도 전체로 취급한다 — 전부 끄면 빈 화면이라 설정으로서 의미가 없고, 사용자가 스스로를
   * 가둘 수 있는 상태를 만들지 않는다.
   */
  grades: string[] | null;
  /** 강사뷰 '미사용 요일' 숨김. null = 미설정(기존 쿠키/기본값 폴백). */
  hideEmptyDays: boolean | null;
  /** 기본뷰 '빈 교시 접기'. null = 미설정(기존 쿠키/기본값 폴백). */
  collapseEmptyPeriods: boolean | null;
  /**
   * **학생 명단 접기**(기본뷰·통합뷰) — true면 셀에 반 이름·강의실·인원만 남기고 명단을 감춘다.
   * 원장 2026-09-04 *"시간표에서 '학생목록 접기' 기능 추가. 접으면 학생 목록이 안보이면 좋겠네"*
   * (ijw 시간표의 `displayOptions.showStudents`와 같은 축 — 거기선 기기 로컬이었지만 여기선 계정 귀속).
   * ⚠️ 명단이 사라지면 셀 높이도 함께 줄어든다(빈 칸을 남기면 접는 뜻이 없다) — `noRosterCellHeight` 참조.
   * null = 미설정(쿠키/기본값 폴백 = 펼침).
   */
  hideStudents: boolean | null;
  /** 기본뷰 셀 색 강도. null = 미설정(기기 저장 localStorage/기본 vivid 폴백). */
  colorMode: TimetableColorPref | null;
  /**
   * 통합뷰 '1시간 단위' — **과목별** 압축 섹션키 목록. null = 미설정(쿠키 폴백).
   * ⚠️ 값이 빈 배열인 과목은 "그 과목은 명시적으로 전부 펼침"이다 — 쿠키 직렬화(빈 과목은 아예 안 적음)와
   * 다르게 **키를 남긴다**. 안 그러면 마지막 하나를 해제했을 때 `?? 쿠키` 폴백이 옛 값을 되살려
   * 토글이 안 꺼진다(URL의 `compact1h=none` 센티널과 같은 이유).
   */
  compact1h: Record<string, number[]> | null;
  /**
   * 기본뷰 **강사 열 순서** — 과목 → 요일 묶음(`mon-thu`) → 이름 배열(원장 2026-09-08 *"드래그해서 …
   * 월목 / 화금 / 수 그룹 내에서"* + *"개인마다 뷰 저장"*). null = 미설정(가나다순). 규칙은 [teacher-order](./teacher-order.ts).
   * 🔴 강사뷰의 테넌트 '강사 순서'(`saveTeacherViewOrder`)와 **다른 축**이다 — 그쪽은 학원 공통, 이쪽은 사람마다.
   */
  teacherOrder: TeacherOrderPref | null;
  /** 편집기에서 적용한 과목별 개인 배치·색·표시 설정. 다른 과목과 기존 설정은 부분 병합한다. */
  editorView?: EditorViewPref | null;
  /**
   * 글씨 크기(작음/보통/큼) — **모든 뷰 공통**. null = 미설정(스토어/기본 '작음' 폴백).
   * 값·배율은 공용 규약(lib/ui-prefs/font-size) — 원스크린·ECS와 같은 어휘를 쓴다.
   */
  fontSize: UiFontSize | null;
  /**
   * 교실뷰 활성도 표의 **건물·층 구분선**. null = 미설정(기본 켜짐).
   * 뷰 세팅은 기기가 아니라 계정에 붙는다(원장 확정 2026-08-04) — 포트가 다른 로컬/배포를 오가도 따라온다.
   */
  roomGroupLines: boolean | null;
  /**
   * 교실뷰 활성도 표의 **축 방향**. `true` = 시간이 세로(강의실이 가로), 기본(null·false) = 시간이 가로.
   * 어느 쪽이 한 화면에 들어오는지는 학원마다 다르다(강의실 22실 · 운영 8시간이면 뒤집는 쪽이 짧다) —
   * 그래서 고르는 값으로 두고, 기기가 아니라 **계정**에 붙인다(roomGroupLines와 같은 규약).
   */
  roomTimeVertical: boolean | null;
  /**
   * 교실뷰 하단 **경고 목록**(정원 초과·시간 겹침) 펼침. null = 미설정(기본 펼침).
   * 원장 2026-08-05: *"너무 공간차지 많이해서 오히려 방해되네"* — 접어도 **건수는 헤더 버튼에 남는다**
   * (숫자까지 지우면 "경고가 없는 화면"이 되고, 그건 접기가 아니라 은폐다).
   * ⚠️ 기본은 **펼침**이다. 경고 목록의 기본값을 '숨김'으로 두면 켜 본 적 없는 사람에겐 영영 안 보인다.
   */
  roomIssues: boolean | null;
  /**
   * 영어 프로그램 보기 필터(전체/EiE/인재원 영어, 0176a `classes.english_track`). null = 미설정(=전체).
   *
   * ECS 랜딩의 같은 필터(`ui_prefs.ecs.englishTrack`)와 **같은 어휘·같은 비대칭 계약**을 쓴다
   * ([`english-track.ts`](../../classes/english-track.ts)) — 인재원 영어 = "EiE가 아닌 전부"(미분류 포함).
   * 화면만 다를 뿐 뜻이 같아야 두 화면을 오갈 때 같은 반이 같은 칸에 있다.
   * ⚠️ 저장은 화면별로 분리한다(ECS 값을 훔쳐 읽지 않는다) — 한쪽에서 좁힌 게 다른 쪽에 번지면
   *    "왜 반이 없지"가 된다. 축이 같다고 저장까지 합치지 말 것.
   */
  englishTrack: EnglishTrackFilter | null;
};

/** 셀 색 강도 — workspace prefs 스토어의 TimetableColorMode와 같은 3값(런타임 소스는 그 스토어). */
export type TimetableColorPref = "vivid" | "mid" | "pastel";

const COLOR_MODES: readonly string[] = ["vivid", "mid", "pastel"];

export const EMPTY_VIEW_PREFS: TimetableViewPrefs = {
  grades: null,
  hideEmptyDays: null,
  collapseEmptyPeriods: null,
  hideStudents: null,
  colorMode: null,
  compact1h: null,
  teacherOrder: null,
  fontSize: null,
  roomGroupLines: null,
  roomTimeVertical: null,
  roomIssues: null,
  englishTrack: null,
};

/**
 * 학년 문자열 → 학제 버킷 라벨("초"·"중"·"고").
 * 설정 학년이 '초1'·'중2'·'고3' 꼴이라 **첫 글자**로 가른다. 그 밖(미래에 '유아'·'N수' 같은 걸
 * 추가하면)은 첫 글자를 그대로 버킷으로 쓴다 — 하드코딩 목록으로 막지 않는다.
 */
export function gradeBucket(grade: string | null | undefined): string | null {
  const g = grade?.trim();
  if (!g) return null;
  // 미취학(6세·7세)은 첫 글자가 숫자라 그대로 두면 "6"·"7" 두 버킷으로 갈린다 — 한 덩어리로 묶는다.
  if (isPreschoolGrade(g)) return PRESCHOOL_LABEL;
  return g[0]!;
}

/** 학년 목록에서 학제 버킷을 등장 순서대로 유일화. ["초1","초2","중1"] → ["초","중"] */
export function bucketsOf(grades: readonly string[]): string[] {
  const out: string[] = [];
  for (const g of grades) {
    const b = gradeBucket(g);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/** 그 버킷에 속하는 학년만. */
export function gradesInBucket(allGrades: readonly string[], bucket: string): string[] {
  return allGrades.filter((g) => gradeBucket(g) === bucket);
}

/** 필터가 실제로 뭔가를 숨기고 있는지(= 배지를 띄워야 하는지). */
export function isGradeFilterActive(
  grades: string[] | null,
  allGrades: readonly string[],
): boolean {
  if (!grades || grades.length === 0) return false;
  // 설정에 없는 학년이 섞여 있어도(학년 이름 변경 등) 남은 교집합 기준으로 판단한다.
  const sel = allGrades.filter((g) => grades.includes(g));
  return sel.length > 0 && sel.length < allGrades.length;
}

/**
 * 툴바 배지 문구. 필터가 아무것도 숨기지 않으면 null.
 *
 * ⚠️ 계정에 저장된 필터는 **조용히 숨기면 안 된다** — "왜 학생이 안 보이지"가 된다.
 * 필터가 걸린 동안엔 이 문구가 툴바에 항상 떠 있어야 한다.
 */
export function gradeFilterLabel(
  grades: string[] | null,
  allGrades: readonly string[],
): string | null {
  if (!isGradeFilterActive(grades, allGrades)) return null;
  const sel = allGrades.filter((g) => grades!.includes(g));
  // 버킷이 통째로 선택됐으면 학제로 줄여 말한다("초1~초6" 대신 "초등만").
  const selBuckets = bucketsOf(sel);
  const bucketComplete = selBuckets.every((b) =>
    gradesInBucket(allGrades, b).every((g) => sel.includes(g)),
  );
  if (bucketComplete) return `${selBuckets.join("·")}만`;
  if (sel.length <= 3) return `${sel.join("·")}만`;
  return `${sel.length}개 학년만`;
}

type StudentLike = { grade?: string | null };
type SlotLike<S extends StudentLike> = { students: S[] };

/**
 * 슬롯의 학생 명단을 학년 필터로 좁힌다. 위 규칙 ①②③ 구현.
 * 필터가 없으면 **원본 배열을 그대로 반환**한다(불필요한 복사로 참조 동일성을 깨지 않는다).
 */
export function applyGradeFilter<S extends StudentLike, T extends SlotLike<S>>(
  slots: readonly T[],
  grades: string[] | null,
): T[] {
  if (!grades || grades.length === 0) return slots as T[];
  const allow = new Set(grades);
  const out: T[] = [];
  for (const slot of slots) {
    // ③ 원래 명단이 없는 반은 손대지 않는다.
    if (slot.students.length === 0) {
      out.push(slot);
      continue;
    }
    const students = slot.students.filter(
      // 학년 미상은 fail-open으로 항상 통과.
      (st) => st.grade == null || st.grade === "" || allow.has(st.grade),
    );
    // ② 다 걸러졌으면 그 반은 이 필터에서 볼 게 없다.
    if (students.length === 0) continue;
    out.push(students.length === slot.students.length ? slot : { ...slot, students });
  }
  return out;
}

/** jsonb의 `{과목: 섹션키[]}` 조각을 방어적으로 정규화. 빈 배열 키는 **보존**(명시적 해제). */
function parseCompact1h(raw: unknown): Record<string, number[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number[]> = {};
  for (const [subject, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!subject || !Array.isArray(v)) continue;
    const sections = v
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    out[subject] = [...new Set(sections)];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** users.ui_prefs jsonb → 타입 안전한 prefs. 모양이 깨져 있어도 절대 throw하지 않는다. */
export function parseViewPrefs(raw: unknown): TimetableViewPrefs {
  if (!raw || typeof raw !== "object") return EMPTY_VIEW_PREFS;
  const tt = (raw as Record<string, unknown>).timetable;
  if (!tt || typeof tt !== "object") return EMPTY_VIEW_PREFS;
  const o = tt as Record<string, unknown>;
  const grades = Array.isArray(o.grades)
    ? o.grades.filter((g): g is string => typeof g === "string" && g.trim() !== "")
    : null;
  return {
    grades: grades && grades.length > 0 ? grades : null,
    hideEmptyDays: typeof o.hideEmptyDays === "boolean" ? o.hideEmptyDays : null,
    collapseEmptyPeriods:
      typeof o.collapseEmptyPeriods === "boolean" ? o.collapseEmptyPeriods : null,
    hideStudents: typeof o.hideStudents === "boolean" ? o.hideStudents : null,
    colorMode:
      typeof o.colorMode === "string" && COLOR_MODES.includes(o.colorMode)
        ? (o.colorMode as TimetableColorPref)
        : null,
    compact1h: parseCompact1h(o.compact1h),
    teacherOrder: parseTeacherOrderPref(o.teacherOrder),
    ...(parseEditorViewPref(o.editorView) ? { editorView: parseEditorViewPref(o.editorView) } : {}),
    fontSize:
      typeof o.fontSize === "string" && (UI_FONT_SIZES as readonly string[]).includes(o.fontSize)
        ? (o.fontSize as UiFontSize)
        : null,
    roomGroupLines: typeof o.roomGroupLines === "boolean" ? o.roomGroupLines : null,
    roomTimeVertical: typeof o.roomTimeVertical === "boolean" ? o.roomTimeVertical : null,
    roomIssues: typeof o.roomIssues === "boolean" ? o.roomIssues : null,
    // 깨진 값은 '전체'가 아니라 **미설정(null)** — 둘 다 결과는 전체지만, null이어야 저장 때 키가 안 남는다.
    englishTrack:
      o.englishTrack === undefined || o.englishTrack === null
        ? null
        : normalizeEnglishTrackFilter(o.englishTrack),
  };
}

/**
 * 저장용 jsonb 조각. 기존 ui_prefs의 **다른 키를 보존**하도록 병합해서 쓴다
 * (tenant_settings 섹션 머지와 같은 규약 — 한 화면 저장이 다른 화면 설정을 지우면 안 된다).
 */
export function serializeViewPrefs(prefs: TimetableViewPrefs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // 전체 선택(=필터 없음)은 키를 지운다 — "전부 켬"과 "미설정"을 굳이 구분할 이유가 없다.
  if (prefs.grades && prefs.grades.length > 0) out.grades = prefs.grades;
  if (prefs.hideEmptyDays !== null) out.hideEmptyDays = prefs.hideEmptyDays;
  if (prefs.collapseEmptyPeriods !== null) out.collapseEmptyPeriods = prefs.collapseEmptyPeriods;
  // 🔴 **양방향 명시**(형제 두 키와 같은 규약) — 읽기가 `계정 ?? 쿠키`라, 끈 것을 키 삭제로 표현하면
  //    다른 기기의 쿠키가 되살리고 동기화가 매번 다시 저장한다(적대 리뷰 2026-09-04).
  if (prefs.hideStudents !== null) out.hideStudents = prefs.hideStudents;
  if (prefs.colorMode !== null) out.colorMode = prefs.colorMode;
  // ⚠️ 빈 배열 과목도 그대로 적는다(명시적 해제). 맵 자체가 비면 키를 안 적는다(= 미설정).
  if (prefs.compact1h && Object.keys(prefs.compact1h).length > 0) out.compact1h = prefs.compact1h;
  // 강사 열 순서 — 비면(전부 초기화) 키를 안 적는다.
  if (prefs.teacherOrder) out.teacherOrder = prefs.teacherOrder;
  if (prefs.editorView) out.editorView = prefs.editorView;
  // 기본값('작음')은 키를 지운다 — 빈 값이 쌓이지 않게(ECS·원스크린과 같은 규약).
  if (prefs.fontSize !== null && prefs.fontSize !== DEFAULT_UI_FONT_SIZE) out.fontSize = prefs.fontSize;
  // 기본값(켜짐)은 키를 지운다 — 빈 값이 쌓이지 않게(fontSize와 같은 규약).
  if (prefs.roomGroupLines === false) out.roomGroupLines = false;
  // 기본값(시간 가로)은 키를 지운다 — 위와 같은 규약(기본값이 jsonb에 쌓이지 않게).
  if (prefs.roomTimeVertical === true) out.roomTimeVertical = true;
  // 기본값(펼침)은 키를 지운다 — 접은 사람만 값을 갖는다(위와 같은 규약).
  if (prefs.roomIssues === false) out.roomIssues = false;
  // 기본값('전체')은 키를 지운다 — 좁혀 본 사람만 값을 갖는다(위와 같은 규약).
  if (prefs.englishTrack !== null && prefs.englishTrack !== "all") out.englishTrack = prefs.englishTrack;
  return out;
}

/**
 * 부분 저장(patch) 병합 — **넘어온 키만** 바꾼다.
 *
 * 뷰 설정은 쓰는 곳이 여러 군데다(필터 패널·표시 토글 동기화·색 강도 토글). 매번 통째로 덮으면
 * 서로의 값을 날린다. 그래서 저장 액션은 항상 이 함수로 "현재값 + 넘어온 키"만 합친다.
 * `undefined` = 안 건드림, `null` = 명시적 해제.
 */
export function mergeViewPrefs(
  current: TimetableViewPrefs,
  patch: Partial<TimetableViewPrefs>,
): TimetableViewPrefs {
  const pick = <K extends keyof TimetableViewPrefs>(k: K): TimetableViewPrefs[K] =>
    patch[k] !== undefined ? (patch[k] as TimetableViewPrefs[K]) : current[k];
  return {
    grades: pick("grades"),
    hideEmptyDays: pick("hideEmptyDays"),
    collapseEmptyPeriods: pick("collapseEmptyPeriods"),
    hideStudents: pick("hideStudents"),
    colorMode: pick("colorMode"),
    roomGroupLines: pick("roomGroupLines"),
    roomTimeVertical: pick("roomTimeVertical"),
    roomIssues: pick("roomIssues"),
    englishTrack: pick("englishTrack"),
    fontSize: pick("fontSize"),
    // compact1h는 과목별이라 통째 교체가 아니라 **과목 단위 병합**이다(아래 참조).
    compact1h: patch.compact1h !== undefined
      ? mergeCompact1h(current.compact1h, patch.compact1h)
      : current.compact1h,
    // 강사 열 순서도 과목·묶음 단위 병합(한 묶음만 저장해 와도 다른 묶음이 안 날아가게).
    teacherOrder: patch.teacherOrder !== undefined
      ? mergeTeacherOrderPref(current.teacherOrder, patch.teacherOrder)
      : current.teacherOrder,
    ...(patch.editorView !== undefined ? { editorView: mergeEditorViewPref(current.editorView, patch.editorView) } : current.editorView ? { editorView: current.editorView } : {}),
  };
}

/**
 * '1시간 단위'는 화면에 **한 과목만** 떠 있으므로 저장도 그 과목만 온다.
 * 통째로 덮으면 다른 과목 설정이 날아간다 — 과목 키 단위로 합친다(쿠키 `writeCompact1hFor`와 같은 규약).
 * ⚠️ 빈 배열은 지우지 않고 **남긴다**(그 과목 '전부 펼침'을 명시 — 쿠키 폴백이 옛 값을 되살리지 않게).
 */
export function mergeCompact1h(
  current: Record<string, number[]> | null,
  patch: Record<string, number[]> | null,
): Record<string, number[]> | null {
  if (patch === null) return null;
  const out: Record<string, number[]> = { ...(current ?? {}) };
  for (const [subject, sections] of Object.entries(patch)) {
    if (!subject) continue;
    out[subject] = [...new Set(sections.filter((n) => Number.isFinite(n) && n > 0))].sort(
      (a, b) => a - b,
    );
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 선택된 학년이 설정 학년 전체를 덮으면 null(=필터 없음)로 정규화.
 * 저장·비교 양쪽에서 "전부 켠 상태"가 필터로 오인되지 않게 한다.
 */
export function normalizeGradeSelection(
  grades: readonly string[] | null,
  allGrades: readonly string[],
): string[] | null {
  if (!grades) return null;
  const sel = allGrades.filter((g) => grades.includes(g));
  if (sel.length === 0 || sel.length === allGrades.length) return null;
  return sel;
}
