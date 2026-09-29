/**
 * 반 정보 없는 보강 보고서의 **'ClassNote로 보낼 반'** 판정(순수 · Vitest).
 *
 * 원장 2026-09-29: 수학 반별 발송이면 보고서의 반 = ClassNote 반 보드인데, 보강 보고서는 반이 비어 있다.
 * → *"메인 수업으로 … 보고서가 가장 많이 발송되는 수업 또는 가장 많은 출결을 하는 수업"* ·
 *   *"'선택해서 보내도록'이 가장 베스트지. 길 잃는것보다 낫다. 보낼 곳이 없으면 '선택'"*.
 * 순서: 후보(그 학생이 다니는 반 보드 대상 수학 반)가 하나면 그 반 → 보낸 보고서가 가장 많은 반 →
 * 동률이면 출결이 가장 많은 반 → 그래도 동률이면 **정하지 않는다**(강사가 고른다).
 * ⚠️ 경로 판정은 워커 [`class-route-decide.mjs`](../../../scripts/_classnote/class-route-decide.mjs)와 **같은 규칙**이어야 한다
 *    (.mjs라 import로 공유하지 못해 옮겨 적었다 — send-class.test.ts가 같은 표를 고정한다).
 */

export const SEND_CLASS_SUBJECTS: ReadonlySet<string> = new Set(["math", "subject_1"]);

/** 이 강사의 수학 보고서가 반 보드로 가는가(보고서 설정 '수학 발송 경로'). 모르는 값 = 아니다(기존 방식). */
export function classRouteAppliesTo(
  report: { classnoteMathRoute?: string | null; classnoteMathRoutePilot?: readonly string[] | null },
  teacherName: string | null | undefined,
): boolean {
  if (report.classnoteMathRoute === "class") return true;
  if (report.classnoteMathRoute === "pilot") return (report.classnoteMathRoutePilot ?? []).includes(teacherName ?? "");
  return false;
}

/**
 * 반별 발송이 **이 학원에서** 켜져 있는가 — ClassNote 기능(모듈)이 켜진 학원 + 보고서 설정 '수학 발송 경로'.
 * 원장 2026-09-30: ClassNote 관련 기능은 ClassNote를 쓰는 학원에만. 모듈이 꺼져 있으면 반 고르기·'보낼 반 없음' 차단이
 * **전부 없다**(예전 그대로). 발송 경로의 모든 판정은 이 함수를 지난다(원스크린·관리자 직접 작성·관리자 일괄 발송).
 */
export function classRouteActive(
  settings: {
    modules?: { disabled?: readonly string[] | null } | null;
    report: { classnoteMathRoute?: string | null; classnoteMathRoutePilot?: readonly string[] | null };
  },
  teacherName: string | null | undefined,
): boolean {
  if ((settings.modules?.disabled ?? []).includes("classnote")) return false;
  return classRouteAppliesTo(settings.report, teacherName);
}

/**
 * 이 보고서에 '보낼 반'이 필요한가 — 수학 · 반별 경로 대상 강사이면서
 *  · 반이 없거나(보강) — 원장 2026-09-29 A안
 *  · 반은 있지만 이 학생이 받을 **살아 있는 반 보드가 없을 때**(`classLive === false`) — ClassNote에서 반이 사라진 종강 반 등.
 *    원장 2026-09-30 *"종강은 클래스노트에 반이 살아있는 한은 계속 보내고, 이후에 반이 사라지면 반 선택이 뜨도록"*.
 *    특강은 정규 반과 같다(특강 반 보드도 만든다).
 * `classLive === null`(확인 못 함 — 0302a 표 없음 등, [[#95]])이면 반 있는 보고서는 **예전처럼** 둔다(워커가 판단).
 */
export function needsSendClass(
  input: { subject?: string | null; classId?: string | null; classLive?: boolean | null },
  routeApplies: boolean,
): boolean {
  if (!routeApplies || !SEND_CLASS_SUBJECTS.has(input.subject ?? "")) return false;
  return !input.classId || input.classLive === false;
}

/**
 * 이 학생을 **워커가 실제로 게시할 수 있는** 반(순수 — 서버 `liveBoardClassIds`와 워커 `isClassRouteEligible`의 판정).
 * 반 대상(활성·발송·수학) ∩ 연결 있음 ∩ 그 학생의 멤버 행이 하나 이상 ok이고 ok 아닌 행이 없다.
 */
export function liveBoardClassIdsOf(
  eligibleClassIds: readonly string[],
  linkedClassIds: readonly string[],
  members: readonly { classId: string; status: string | null }[],
): string[] {
  const linked = new Set(linkedClassIds);
  const ok = new Set<string>();
  const held = new Set<string>();
  for (const m of members) (m.status === "ok" ? ok : held).add(m.classId);
  return eligibleClassIds.filter((id) => linked.has(id) && ok.has(id) && !held.has(id));
}

/** 보낼 반 게이트(`blockedForNoSendClass`) 입력 모양 — 관리자 일괄 경로(미발송 일괄·재발송·멈춤 복구·대량 작성)가 같은 변환을 쓴다. */
export function sendClassRow(r: { id: unknown; student_id: unknown; class_id: unknown }): {
  id: string;
  studentId: string;
  classId: string | null;
} {
  return { id: r.id as string, studentId: r.student_id as string, classId: (r.class_id as string | null) ?? null };
}

/** 반별 발송 대상 수학 행인가(ClassNote 모듈 + '수학 발송 경로' + 작성 강사) — 보낼 반 게이트를 태울 행. */
export function isSendClassRouteRow(
  settings: Parameters<typeof classRouteActive>[0],
  r: { subject?: unknown; teacher_name?: unknown },
): boolean {
  return SEND_CLASS_SUBJECTS.has((r.subject as string | null) ?? "") && classRouteActive(settings, (r.teacher_name as string | null) ?? null);
}

/** 보낼 반이 없어 발송을 막을 때의 안내(원장 2026-09-30 *"담당 반이 없으면 보고서 발송 불가능하게"*) — 서버·화면 한 벌. */
export const NO_SEND_CLASS_ERROR = "보낼 반이 없어 발송할 수 없습니다 — 이 학생의 반을 확인하세요(담당 반이 아니거나 반 보드가 없는 학생)";

/**
 * 메인 수업 고르기. 정할 수 없으면 null(= 강사가 고른다).
 * @param candidates 후보 반 id(반 보드 대상 반만)
 * @param sent 반별 ClassNote로 보낸 보고서 수
 * @param attended 반별 출결 기록 수
 */
export function pickMainClass(
  candidates: readonly string[],
  sent: Readonly<Record<string, number>>,
  attended: Readonly<Record<string, number>>,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const top = (score: (id: string) => number, ids: readonly string[]) => {
    const best = Math.max(...ids.map(score));
    return ids.filter((id) => score(id) === best);
  };
  const bySent = top((id) => sent[id] ?? 0, candidates);
  if (bySent.length === 1) return bySent[0]!;
  const byAtt = top((id) => attended[id] ?? 0, bySent);
  return byAtt.length === 1 ? byAtt[0]! : null;
}

/**
 * 후보를 **작성 강사가 담당하는 반**으로 좁힌다(원장 2026-09-29 *"담당인 반만 뜨도록"*).
 * 담당 = 담임 ∪ 그날 임시 위임 — 원스크린 명단과 같은 기준(`getTeachingClassIds`).
 * - 강사(`restrict`) = 담당 반만. 하나도 없으면 빈 목록 → 반을 고르게 하지 않고 기존 1인 보드로 간다
 *   (남의 반 학생 보강을 그 반 단체방에 올리지 않는다).
 * - 관리자 계열 = 담당 반이 있으면 그 반만, 없으면 전부(사무실이 대신 보내는 경우).
 */
export function mineOnly<T extends { id: string }>(candidates: readonly T[], mine: ReadonlySet<string>, restrict: boolean): T[] {
  const own = candidates.filter((c) => mine.has(c.id));
  return own.length || restrict ? own : [...candidates];
}
