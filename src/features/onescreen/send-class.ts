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

/**
 * 보강 보고서의 **'보낼 반' 최종 판정**(순수 — 원장 2026-09-30 *"애초에 보강 추가로 선택된 반에 보고서가 발송되면 되는거아닌가?"*).
 * **앱이 정하고 적는다**(`classnote_class_id`) — 워커 [`pickRouteClass`](../../../scripts/_classnote/class-route-decide.mjs)는
 * 보고서 반 → **적힌 보낼 반** → 보강 반(적힌 값이 없는 옛 대기분) 순으로 따른다. 그래서 앱이 고른 반 = 실제로 간 반.
 * 우선순위:
 *  1. 보강 추가 때 고른 반(`makeupClassId`, 0171a `makeup_class_id`)에 이 학생의 **살아 있는 반 보드**가 있으면 그 반 — 묻지 않는다.
 *     (살아 있는 반 보드 = 보고서 자기 반과 같은 판정 `liveBoardClassIdsOf`. 앵커 자체는 **저장할 때 서버가 확인한다** —
 *     `saveLessonReport`가 `findMakeupAnchor`(그날 담당 반 · 같은 과목 · 종강 전)로 받은 값만 적는다. 여기서 담당 반으로 다시
 *     좁히지 않는 이유 = 이미 적힌 앵커는 그 뒤 위임이 끝나거나 종강해도 그 수업을 한 반이라서다.)
 *  2. 강사가 고른 반(`chosen`) — 후보 안에 있을 때만.
 *  3. 🔴 보강 반이 있는데 보드가 없으면 **자동으로 다른 반에 보내지 않고 묻는다**(`makeupMismatch` — 화면이 경고 한 줄을 띄운다).
 *     기본 선택 = 메인 수업(`main`).
 *  4. 메인 수업(`main`, pickMainClass) → 없으면 묻는다.
 * 후보가 없으면 `none`(발송 불가). 1은 후보 목록과 무관하다(앵커는 저장 때 확인됐다 — 위 1).
 */
export type SendClassDecision =
  | { kind: "send"; classId: string; via: "makeup" | "chosen" | "auto" }
  | { kind: "ask"; defaultId: string | null; makeupMismatch: boolean }
  | { kind: "none"; makeupMismatch: boolean };

export function decideSendClass(a: {
  candidates: readonly string[];
  makeupClassId: string | null | undefined;
  makeupLive: boolean;
  chosen: string | null | undefined;
  /** 메인 수업(pickMainClass) — 자동 고르기를 하지 않는 경로(autoPick=false)는 null. */
  main: string | null;
}): SendClassDecision {
  if (a.makeupClassId && a.makeupLive) return { kind: "send", classId: a.makeupClassId, via: "makeup" };
  const mismatch = !!a.makeupClassId;
  if (!a.candidates.length) return { kind: "none", makeupMismatch: mismatch };
  if (a.chosen) {
    return a.candidates.includes(a.chosen)
      ? { kind: "send", classId: a.chosen, via: "chosen" }
      : { kind: "ask", defaultId: a.main && a.candidates.includes(a.main) ? a.main : null, makeupMismatch: mismatch };
  }
  const main = a.main && a.candidates.includes(a.main) ? a.main : null;
  if (mismatch) return { kind: "ask", defaultId: main, makeupMismatch: true };
  return main ? { kind: "send", classId: main, via: "auto" } : { kind: "ask", defaultId: null, makeupMismatch: false };
}

/**
 * 보낼 반 **후보**로 세울 수 있는 반인가(순수) — 원장 2026-09-30 *"종강이 아닌 담당 반에서 뜨는게 맞지? 학생과 접점이 있는"* ·
 * *"보내는 반도 마찬가지고"*. = 수학 · 활성 · 보고서 발송 · **그날 종강 전**(`closed_at`이 없거나 그날 이후).
 * ⚠️ 종강 반은 보고서 **자기 반**으로는 보드가 살아 있는 동안 계속 받는다(`classBoardLiveForStudent` — 여기와 무관).
 *    다른 보고서가 고르는 **후보**로만 빠진다.
 */
export function isSendCandidateClass(
  c: { subject: string | null; is_active: boolean | null; report_optout: boolean | null; closed_at: string | null },
  date: string,
): boolean {
  if (!SEND_CLASS_SUBJECTS.has(c.subject ?? "") || !c.is_active || c.report_optout) return false;
  return !c.closed_at || c.closed_at.slice(0, 10) >= date;
}

/**
 * 관리자 일괄 경로의 **보낼 반 게이트 한 행**(순수 — 서버 `blockedForNoSendClass`). 워커 `pickRouteClass`와 **같은 순서**:
 * 보고서 반(살아 있음) → 적힌 보낼 반(살아 있음) → 보강 반(반 없는 보강 · 살아 있음) → 막는다.
 * 보강 반으로 통과하면 `rewriteTo` = 보강 반 — '보낼 반'을 그 반으로 적어 둔다(보강 반을 모르는 옛 워커도 같은 반으로 가게).
 * 🔴 **이미 어딘가 게시된 행(`sentAt`)은 다시 적지 않는다** — 옛 위치 기록이 지워지면 회수가 글을 못 찾는다.
 */
export function sendClassGateRow(r: {
  classId: string | null;
  classLive: boolean;
  storedId: string | null;
  storedLive: boolean;
  makeupClassId: string | null;
  makeupLive: boolean;
  sentAt: string | null;
}): { pass: boolean; rewriteTo: string | null } {
  if (r.classId && r.classLive) return { pass: true, rewriteTo: null };
  if (r.storedId && r.storedLive) return { pass: true, rewriteTo: null };
  if (!r.classId && r.makeupClassId && r.makeupLive)
    return { pass: true, rewriteTo: r.sentAt || r.storedId === r.makeupClassId ? null : r.makeupClassId };
  return { pass: false, rewriteTo: null };
}
