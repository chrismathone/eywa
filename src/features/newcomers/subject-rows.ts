/**
 * 신규생 관리 **과목별 행** — 순수 규칙(IO 없음, Vitest). 0256a.
 *
 * 원장 2026-09-10: *"신규생 관리에 '과목'도 붙여줘. 여러 과목이면 과목별로 행이 존재해야함."* → 체크도
 * **"과목별로 따로"**. 실측: 최근 90일 신규 31명 중 9명이 수학+영어 — 두 과목은 전화하는 사람이 다르다.
 *
 * 🔑 두 가지 모양을 **같은 재료에서** 만든다:
 *    ① **과목 행**(`buildSubjectAnchors` + `effectiveChecks`) — 신규생 관리 표. 학생 × 과목.
 *    ② **학생 한 줄로 접은 것**(`collapseChecks`) — 운영실·브리핑처럼 "학생 N명"을 세는 자리.
 *       🔴 접을 때 항목은 **모든 과목이 끝났을 때만** 완료다 — 수학만 전화했는데 "완료"로 세면 영어
 *          학부모 콜을 놓친 학생이 운영실 숫자에서 조용히 사라진다.
 * 🔴 **옛 기록(과목 '')은 모든 과목에 비춘다** — 0256a 이전 체크는 과목 없이 저장됐다. 과목 칸 기록이
 *    **있으면(완료든 해제든) 그것이 이긴다** — 수학 행에서 해제한 것이 옛 완료에 덮이면 해제가 안 먹힌다.
 * 🔴 수강이 없는 학생도 **한 줄은 선다**(과목 `null`) — 반 배정 전 신입이 가장 챙길 대상이다.
 */

/** 과목 무관(옛 기록) 표식 — 0256a의 `subject` 기본값과 같은 글자. */
export const ANY_SUBJECT = "";

/** 수강 한 줄 — 과목은 반에서 온다(학생 행에 과목이 없다). `endDate`는 반열림(`[start, end)`) 종료일. */
export type EnrollmentForAnchor = {
  studentId: string;
  startDate: string | null;
  subject: string | null;
  endDate?: string | null;
};

/** 체크 한 줄 — 0256a 이전 스키마면 `subject`가 없다(= 과목 무관). */
export type CheckRowInput = {
  studentId: string;
  itemKey: string;
  doneOn: string | null;
  subject?: string | null;
  /** 완료 메모('수행: … / 결과: …') · 연결 상담 — 표시용(판정에 안 쓴다). */
  memo?: string | null;
  consultationId?: string | null;
};

/**
 * 학생별 **과목 → 첫 수업일**. 첫 수업일 = 그 과목 수강 시작일 중 가장 이른 날.
 * ⚠️ 과목이 빈 반(과목 미지정)의 수강은 과목 축에 세울 자리가 없어 **버리지 않고** 과목 무관 첫 수업일에만
 *    반영한다 — 그래야 과목 행이 하나도 없는 학생도 첫 수업일은 안다.
 */
export function buildSubjectAnchors(
  enrollments: readonly EnrollmentForAnchor[],
  /**
   * 주면 **끝난 과목은 줄을 안 세운다** — 수강 하나라도 `endDate`가 없거나 오늘보다 뒤여야 그 과목이 산다.
   * 🔴 그만둔 과목(영어 체험만 하고 수학만 남은 신입)이 줄로 남으면 "첫 수업 후 콜 지연"이 90일 내내 울린다.
   * ⚠️ 첫 수업일은 그 과목의 **끝난 수강까지 포함**해 가장 이른 날이다 — 같은 과목 안에서 반을 옮겼으면
   *    처음 반의 시작일이 진짜 첫 수업이다. 종료는 반열림(`[start, end)`)이라 `endDate <= today`면 끝났다.
   */
  today?: string,
): {
  /** 학생 → (과목 → 첫 수업일). 과목 행을 세우는 축. */
  bySubject: Map<string, Map<string, string | null>>;
  /** 학생 → 과목 무관 첫 수업일(전 수강 중 최솟값) — 옛 규칙 그대로(접은 한 줄이 쓴다). */
  earliest: Map<string, string>;
} {
  const bySubject = new Map<string, Map<string, string | null>>();
  const earliest = new Map<string, string>();
  /** 학생 → 아직 안 끝난 수강이 있는 과목. */
  const alive = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const endKey = e.endDate && /^\d{4}-\d{2}-\d{2}/.test(e.endDate) ? e.endDate.slice(0, 10) : null;
    const sub = (e.subject ?? "").trim();
    if (sub && !(today && endKey && endKey <= today)) {
      let set = alive.get(e.studentId);
      if (!set) alive.set(e.studentId, (set = new Set()));
      set.add(sub);
    }
    const d = e.startDate && /^\d{4}-\d{2}-\d{2}/.test(e.startDate) ? e.startDate.slice(0, 10) : null;
    if (d) {
      const prev = earliest.get(e.studentId);
      if (!prev || d < prev) earliest.set(e.studentId, d);
    }
    const subject = (e.subject ?? "").trim();
    if (!subject) continue;
    let map = bySubject.get(e.studentId);
    if (!map) bySubject.set(e.studentId, (map = new Map()));
    const cur = map.get(subject);
    if (cur === undefined) map.set(subject, d);
    else if (d && (!cur || d < cur)) map.set(subject, d);
  }
  // 끝난 과목을 걷는다(위 `today` 주석). 과목이 다 빠진 학생은 과목 없는 한 줄로 떨어진다(사라지지 않는다).
  if (today) {
    for (const [sid, map] of bySubject) {
      const live = alive.get(sid);
      for (const sub of [...map.keys()]) if (!live?.has(sub)) map.delete(sub);
      if (map.size === 0) bySubject.delete(sid);
    }
  }
  return { bySubject, earliest };
}

/** 학생 → (과목 → (항목 → 완료일)) — 행이 **있다**는 사실을 담는다(해제 = 행은 있고 값이 null). */
export type ChecksBySubject = Map<string, Map<string, Map<string, string | null>>>;

export function indexChecks(rows: readonly CheckRowInput[]): ChecksBySubject {
  const out: ChecksBySubject = new Map();
  for (const r of rows) {
    const subject = (r.subject ?? ANY_SUBJECT).trim();
    let bySubj = out.get(r.studentId);
    if (!bySubj) out.set(r.studentId, (bySubj = new Map()));
    let items = bySubj.get(subject);
    if (!items) bySubj.set(subject, (items = new Map()));
    const d = r.doneOn && /^\d{4}-\d{2}-\d{2}/.test(r.doneOn) ? r.doneOn.slice(0, 10) : null;
    items.set(r.itemKey, d);
  }
  return out;
}

/**
 * 그 과목 행이 보는 체크 — **과목 칸 기록이 있으면 그것, 없으면 옛 기록('')**.
 * 🔴 "있으면"은 값이 아니라 **행의 존재**다 — 해제(null)도 기록이다. 값으로 보면 해제가 옛 완료에 덮인다.
 */
export function effectiveChecks(
  checks: ChecksBySubject,
  studentId: string,
  subject: string | null,
): Record<string, string | null> {
  const bySubj = checks.get(studentId);
  const legacy = bySubj?.get(ANY_SUBJECT);
  const own = subject ? bySubj?.get(subject) : undefined;
  const out: Record<string, string | null> = {};
  if (legacy) for (const [k, v] of legacy) out[k] = v;
  if (own) for (const [k, v] of own) out[k] = v;
  return out;
}

/**
 * 학생 한 줄로 **접은** 체크 — 항목은 **그 학생의 모든 과목에서 끝났을 때만** 완료(가장 늦은 완료일).
 * 과목이 하나도 없으면 과목 무관 기록 그대로다(옛 동작과 글자 그대로 같다).
 */
export function collapseChecks(
  checks: ChecksBySubject,
  studentId: string,
  subjects: readonly string[],
  itemKeys: readonly string[],
): Record<string, string | null> {
  if (subjects.length === 0) return effectiveChecks(checks, studentId, null);
  const per = subjects.map((s) => effectiveChecks(checks, studentId, s));
  const out: Record<string, string | null> = {};
  for (const key of itemKeys) {
    let latest: string | null = null;
    let allDone = true;
    for (const c of per) {
      const d = c[key] ?? null;
      if (!d) {
        allDone = false;
        break;
      }
      if (!latest || d > latest) latest = d;
    }
    if (allDone && latest) out[key] = latest;
  }
  return out;
}

/** 과목 키 모양 — 0256a CHECK와 같은 규칙. 화면이 보낸 과목 문자열을 서버가 한 번 더 거른다. */
export function isSubjectKey(v: unknown): v is string {
  return typeof v === "string" && /^[a-z][a-z0-9_]{0,31}$/.test(v);
}

/** 과목 행의 완료 메모·연결 상담 — 과목 무관('') 기록 위에 그 과목 기록이 덮는다(effectiveChecks와 같은 우선순위). */
export function checkDetailsOf(rows: CheckRowInput[], studentId: string, subject: string | null): Record<string, { memo: string | null; consultationId: string | null }> {
  const mine = rows.filter((r) => r.studentId === studentId && (!(r.subject ?? "") || r.subject === subject))
    .sort((a, b) => Number(!!a.subject) - Number(!!b.subject));
  return Object.fromEntries(mine.map((r) => [r.itemKey, { memo: r.memo ?? null, consultationId: r.consultationId ?? null }]));
}
