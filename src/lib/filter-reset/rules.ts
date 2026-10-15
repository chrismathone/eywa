/**
 * 필터 10분 초기화 — 규칙 한 곳(원장 2026-10-15 *"상단 필터 다시 접속하면 필터 초기화하게"* → *"필터는 10분이상 페이지 재접속하지
 * 않으면 리셋되도록"* → *"다른 필터들도 같은 방식 적용"*).
 *
 * 뜻: 화면을 **새로 열 때**(새 창·새 탭·새로고침·메뉴로 다시 들어옴·다음 날 되살린 창) 그 화면을 10분 넘게 안 봤으면 행을 좁히는
 *     필터를 기본값으로 연다. 정렬·기간(달·주·날짜)·탭·보기 방식·글자 크기·한 쪽 줄 수는 그대로 둔다 — 필터만.
 *
 * - **계정에 저장되는 필터**(`ui_prefs` — 아래 `SAVED_FILTER_KEYS` 10곳)만 이 규칙이 따로 필요하다. 서버가 쿠키(`FILTER_SEEN_COOKIE`)의
 *   '마지막으로 본 시각'을 보고 10분이 넘었으면 저장된 필터를 쓰지 않고 그 키를 지운다([`server.ts`](./server.ts) `freshSavedFilters`).
 * - 주소·화면 안에만 드는 필터(상담·퇴원·수납·성적 원장 …)는 원래 저장되지 않아 **새로 열면 늘 기본값**이다 — 같은 방식이 이미 성립한다.
 * - 🔴 **열어 둔 화면은 다시 보여도 그대로다**(숨겨 둔 창 · 이전 화면 유지의 화면 · 다른 프로그램을 쓰다 돌아온 탭). 그 자리에서
 *   문서를 다시 불러 필터를 되돌리면 떠나기 확인이 없는 입력 초안(수납 회차 확정 표 · 교재 신청 작성 · 영어 시트 저장 대기 등)이
 *   말없이 사라진다(적대 재리뷰 2026-10-15). 그 시간은 '안 본 시간'으로 세므로, 그 화면을 **새로** 열면 그때 기본값이다.
 *
 * '마지막으로 본 시각'은 화면 문서가 보이는 동안·가려질 때·떠날 때 적는다([`filter-seen-tracker.tsx`](../../components/filter-seen-tracker.tsx)).
 * 기기(브라우저) 단위다 — 다른 PC에서 처음 열면 그 PC에선 안 본 화면이라 기본값으로 연다(저장값은 계정에 있어도 10분이 지나면 쓰지 않는 값).
 *
 * 🔴 새 화면이 필터를 계정에 저장하면 `SAVED_FILTER_KEYS`·`FILTER_SCREENS`에 한 줄씩 더하고, 저장값을 읽는 곳은 `freshSavedFilters`를
 *    지나게 할 것(가드 `rules.test.ts`가 이름공간마다 그 호출을 찾는다).
 * ⚠️ 서버·클라가 함께 쓰는 일반 모듈이다 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 */

/** 이만큼 안 본 화면의 필터는 기본값으로 돌아간다(= 숨은 화면 새로고침 `STALE_AFTER_MS`와 같은 값 — 가드가 잠근다). */
export const FILTER_RESET_AFTER_MS = 10 * 60 * 1000;

/** 화면별 '마지막으로 본 시각' 쿠키. 값 = `키:유닉스초~키:유닉스초`(쿠키 값 문법에 안전한 문자만 — `,`·`;`·공백 없음). */
export const FILTER_SEEN_COOKIE = "eywa-fseen";

/** 보이는 동안 이 간격으로 다시 적는다(떠나는 신호를 못 받고 꺼져도 그 화면을 본 시각이 이만큼 안에 남는다). */
export const FILTER_SEEN_TOUCH_MS = 30_000;

/** 쿠키에 남기는 기간 — 이보다 오래된 칸은 어차피 기본값이라 적을 때 떨군다. */
export const FILTER_SEEN_KEEP_SEC = 24 * 60 * 60;

export type FilterScreen = {
  /** 쿠키에 적는 키 — 영문 소문자·숫자·`-`만. */
  key: string;
  /** 이 화면의 주소인가(`usePathname()` — 쿼리 없음). */
  match: (pathname: string) => boolean;
};

const exact = (...paths: string[]) => (pathname: string) => paths.includes(pathname);
const under = (root: string) => (pathname: string) => pathname === root || pathname.startsWith(`${root}/`);

/** 계정에 필터를 저장하는 화면 — '마지막으로 본 시각'을 적는 곳(목록 화면 본체만 · 상세·인쇄 화면은 아니다). 전수 조사 2026-10-15. */
export const FILTER_SCREENS: readonly FilterScreen[] = [
  { key: "students", match: exact("/students") },
  { key: "classes", match: exact("/classes") },
  { key: "staff", match: exact("/staff") },
  { key: "timetable", match: exact("/timetable", "/timetable-dev") },
  // 반 시트(`/ecs/<반>`)에 들어가 있어도 영어 시트를 보는 중이다 — 첫 화면·반 시트가 같은 필터(프로그램·담임)로 반 목록을 고른다
  { key: "ecs", match: under("/ecs") },
  { key: "attendance-live", match: exact("/attendance/live") },
  { key: "enrollment", match: exact("/enrollment") },
  { key: "inventory", match: exact("/inventory") },
  { key: "shuttle-today", match: exact("/shuttle/today") },
  { key: "class-review", match: exact("/class-review") },
];

/**
 * 저장 필터가 있는 이름공간(`ui_prefs.<ns>`) → 그 화면 키와 **필터 키만**(정렬·보기 키는 넣지 않는다). 서버 로더가 `freshSavedFilters`로
 * 거른다. 전수 조사 2026-10-15 — 이 밖의 이름공간(출석부·원스크린·성적·상담 통계·대시보드·포트폴리오 등)은 정렬·접기·글자 크기 같은
 * 보기 설정뿐이다(출석부 '퇴직 담임 숨김'도 강사 고르기 목록의 표시라 필터가 아니다).
 */
export const SAVED_FILTER_KEYS = {
  students: { screen: "students", keys: ["subject", "grade", "teacher", "noenr"] },
  classes: { screen: "classes", keys: ["kind", "subject", "teacher", "days"] },
  staff: { screen: "staff", keys: ["role", "subject", "emp"] },
  timetable: { screen: "timetable", keys: ["grades", "englishTrack"] },
  ecs: { screen: "ecs", keys: ["englishTrack", "teacher", "goalsRole"] },
  attendanceLive: { screen: "attendance-live", keys: ["subject"] },
  enrollmentStats: { screen: "enrollment", keys: ["kinds"] },
  inventory: { screen: "inventory", keys: ["hideDisposed"] },
  shuttleToday: { screen: "shuttle-today", keys: ["direction"] },
  classReview: { screen: "class-review", keys: ["listFilter"] },
} as const satisfies Record<string, { screen: string; keys: readonly string[] }>;

export function filterScreenOf(pathname: string | null | undefined): FilterScreen | null {
  if (!pathname) return null;
  return FILTER_SCREENS.find((s) => s.match(pathname)) ?? null;
}

const KEY_RE = /^[a-z0-9-]+$/;

/** 쿠키 원문 → `{ 키: 유닉스초 }`. 깨진 조각은 조용히 버린다. */
export function parseFilterSeen(raw: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    /* 그대로 */
  }
  for (const rec of text.split("~")) {
    const i = rec.indexOf(":");
    if (i <= 0) continue;
    const key = rec.slice(0, i);
    const sec = Number(rec.slice(i + 1));
    if (KEY_RE.test(key) && Number.isInteger(sec) && sec >= 0) out[key] = sec;
  }
  return out;
}

/** `{ 키: 유닉스초 }` → 쿠키 원문. `nowSec`보다 `FILTER_SEEN_KEEP_SEC` 넘게 오래된 칸은 떨군다. */
export function serializeFilterSeen(map: Record<string, number>, nowSec: number): string {
  return Object.entries(map)
    .filter(([key, sec]) => KEY_RE.test(key) && Number.isInteger(sec) && nowSec - sec <= FILTER_SEEN_KEEP_SEC)
    .map(([key, sec]) => `${key}:${sec}`)
    .join("~");
}

/** 이 화면을 10분 안에 봤나. 기록이 없거나 0이면 안 본 것이다. */
export function isFilterSeenFresh(seenSec: number | undefined, nowMs: number): boolean {
  if (!seenSec) return false;
  return nowMs - seenSec * 1000 <= FILTER_RESET_AFTER_MS;
}
