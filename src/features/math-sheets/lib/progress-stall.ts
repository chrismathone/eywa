/**
 * 진도 정체 판정 — 수학만의 경고. 순수(Vitest).
 *
 * 영어 시트의 경고는 "목표 밖 교재" 하나뿐이지만 수학엔 축이 하나 더 있다. 수학은 학생마다 진도선이
 * 따로라서 **한 명이 몇 주째 제자리인 것**이 반 전체 화면에서는 안 보인다(원스크린은 하루 단위다).
 *
 * 🔴 **1회로는 경고하지 않는다.** 실측(2026-08): 직전 수업과 진도 문자열이 글자까지 같은 경우가
 *    163건 · 학생 102명 — 보고서가 있는 학생 192명의 **절반**이다. 한 차시를 두 번에 나눠 하는 건
 *    정상이라, 1회부터 띄우면 경고가 아니라 배경이 되고 진짜 정체(박서준: 8/5·8/19·8/26 같은 진도 +
 *    커리큘럼 위치 341→341)가 그 안에 묻힌다. 기본 3회 연속(원장 확인 전까지의 기본값).
 * 🔴 **진도 문자열이 비면 판정하지 않는다** — 안 적은 것을 "같은 진도"로 읽으면 미작성이 정체로
 *    둔갑한다(이미 미작성으로 세고 있는 칸을 두 번 세는 셈이기도 하다).
 * ⚠️ 진도 문자열은 **여러 줄**이다(실측: 한 칸에 차시 두세 개가 줄바꿈으로 이어져 들어온다). 그래서
 *    교재명용 `normalizeBookName`을 쓰지 않고 여기서 **모든 공백류(줄바꿈 포함)를 지우는** 정규화를
 *    따로 둔다 — 같은 진도를 줄바꿈만 다르게 적은 것을 다른 진도로 보면 정체를 놓친다.
 */

/** 지우는 문자 — 공백류 전체(`\s`: 스페이스·탭·줄바꿈·NBSP) + 나열 기호. */
const DROP_RE = /[\s·・.,()[\]\-_/]/u;

/** 진도 비교 키 — 소문자화 + 위 문자 제거. 표시에는 쓰지 않는다(원문 보존). */
export function normalizeProgress(v: string | null | undefined): string {
  let out = "";
  for (const ch of String(v ?? "").toLowerCase()) if (!DROP_RE.test(ch)) out += ch;
  return out;
}

/** 기본 임계 — 같은 진도가 이만큼 **연속**이면 정체. */
export const DEFAULT_STALL_RUN = 3;

export type ProgressPoint = {
  date: string;
  progress: string | null;
};

/**
 * 그 학생의 이 달 기록에서 **정체로 판정된 날짜들**. 연속 구간이 임계에 닿는 순간부터
 * 그 구간의 나머지 날이 전부 정체로 표시된다(첫 두 번은 아직 정체가 아니다).
 *
 * 예) 임계 3, 진도가 A A A A 면 → 3번째·4번째 날이 정체.
 */
export function stalledDatesOf(
  points: readonly ProgressPoint[],
  run: number = DEFAULT_STALL_RUN,
): string[] {
  if (run < 2) return [];
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: string[] = [];
  let streak = 0;
  let prev = "";
  for (const p of sorted) {
    const key = normalizeProgress(p.progress);
    if (!key) {
      // 안 적힌 날은 연속을 **끊지도 잇지도 않는다** — 결석·미작성 한 번으로 정체가 리셋되면
      // 몇 달째 제자리인 학생이 영영 안 걸린다. 다만 그 날 자체는 정체가 아니다.
      continue;
    }
    if (key === prev) streak += 1;
    else {
      streak = 1;
      prev = key;
    }
    if (streak >= run) out.push(p.date);
  }
  return out;
}

/** 그 학생이 이 달에 정체 판정을 받았는가(레일 카드 배지). */
export function isStalled(points: readonly ProgressPoint[], run: number = DEFAULT_STALL_RUN): boolean {
  return stalledDatesOf(points, run).length > 0;
}

/**
 * 커리큘럼 위치가 안 움직였는가 — `progress_containers`의 보조 근거.
 * 🔴 **이것만으로 경고하지 않는다.** 위치는 진도 문자열을 커리큘럼에 맞춰 본 파생값이라
 *    매칭이 실패하면(교재가 '프린트'인 경우 등) 안 움직인 것처럼 보인다. 문자열 반복과 **함께** 볼 때만
 *    "제자리"라고 말할 수 있다.
 */
export function positionFrozen(start: number | null, last: number | null): boolean {
  if (start == null || last == null) return false;
  return start === last;
}
