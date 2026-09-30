/**
 * 반 정보 없는 보강 보고서의 **'ClassNote로 보낼 반'** 판정(순수 · Vitest).
 *
 * 🔴 2026-09-30 원장 결정 이후: **보강 보고서의 발송 반 = 보강 반(`makeup_class_id`) = 출석부 칸의 반** — 따로 고르지 않는다
 *    ([`makeup-anchor.ts`](./makeup-anchor.ts) 불변식). 아래 옛 설명의 '메인 수업 자동 고르기'는 이제 **반 미정 보강의 기본 선택**으로만
 *    쓰이고, 강사가 고르면 그 반이 보강 반이 된다(출석부 칸도 함께 옮겨진다 — `changeMakeupAnchor`).
 *    정규 보고서의 반 보드가 없어지면 다른 반으로 보내지 않고 막는다(`BOARD_MISSING_ERROR`).
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
 * 정규 보고서(반 있음)의 반 보드가 없어졌을 때 — **다른 반으로 보내지 않고 막는다**(원장 결정 4, 2026-09-30).
 * 반 보드를 되살리는 일(동기화)은 사람이 한다 — 이 문장은 그 필요만 알린다(버튼 배선은 별건).
 */
export const BOARD_MISSING_ERROR =
  "이 반의 ClassNote 반 보드가 없어 발송하지 않았습니다(다른 반으로 보내지 않습니다) — 관리자에게 '지금 반 보드 동기화'(수업보고서 발송 큐)를 부탁한 뒤 다시 보내 주세요. 저장은 됐습니다";

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
 * 보강 보고서의 **'보낼 반' 최종 판정**(순수) — 🔴 원장 2026-09-30: 보고서 반 = 출석부 반 = 발송 반.
 * 보강 보고서의 발송 반은 **보강 반(앵커) 그 자체**다. 따로 고른 반·메인 수업으로 **자동으로** 보내지 않는다.
 *  1. 앵커가 있고 이 학생의 **살아 있는 반 보드**가 있으면 그 반 — 묻지 않는다.
 *  2. 앵커가 있는데 보드가 없거나(`makeupMismatch`), 앵커가 없으면('반 미정') **묻는다** — 강사가 고른 반이
 *     **새 보강 반**이 된다(저장이 출석부 칸을 그 반으로 함께 옮긴다). 기본 선택 = 메인 수업(`main`, 앵커 반 제외).
 *  3. 고를 후보가 없으면 `none`(발송 불가).
 * ⚠️ 옛 '고른 반(chosen)만 적고 보내기'·'메인 수업 자동 발송'은 없앴다 — 보고서 반과 출석부 반이 갈리는 길이었다(C1·C9).
 */
export type SendClassDecision =
  | { kind: "send"; classId: string; via: "makeup" }
  | { kind: "ask"; defaultId: string | null; makeupMismatch: boolean }
  | { kind: "none"; makeupMismatch: boolean };

export function decideSendClass(a: {
  /** 고를 수 있는 반(앵커 반은 빼고 넘긴다 — 보드가 없는 반을 다시 고르게 하지 않는다). */
  candidates: readonly string[];
  makeupClassId: string | null | undefined;
  makeupLive: boolean;
  /** 메인 수업(pickMainClass) — 기본 선택으로만 쓴다. */
  main: string | null;
}): SendClassDecision {
  if (a.makeupClassId && a.makeupLive) return { kind: "send", classId: a.makeupClassId, via: "makeup" };
  const mismatch = !!a.makeupClassId;
  if (!a.candidates.length) return { kind: "none", makeupMismatch: mismatch };
  const main = a.main && a.candidates.includes(a.main) ? a.main : null;
  return { kind: "ask", defaultId: main, makeupMismatch: mismatch };
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
 * 관리자 일괄 경로의 **보낼 반 게이트 한 행**(순수 — 서버 `blockedForNoSendClass`). 워커 `pickRouteClass`와 **같은 판정**:
 *  · 정규 보고서(반 있음) = 그 반 보드가 살아 있을 때만 통과. 죽었으면 막는다(다른 반으로 보내지 않는다 — 원장 결정 4).
 *  · 보강 보고서 = **보강 반(앵커)**의 보드가 살아 있을 때만 통과. 적힌 '보낼 반'이 앵커와 다르면 막는다(보고서 반 ≠ 발송 반).
 *    통과하면 `rewriteTo` = 앵커 — '보낼 반'을 앵커로 적어 둔다(보강 반을 모르는 옛 워커도 같은 반으로 가게).
 *  · 반 미정 보강(앵커 없음) = 막는다(반 없는 발송을 만들지 않는다).
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
  if (r.classId) return { pass: r.classLive, rewriteTo: null };
  if (!r.makeupClassId) return { pass: false, rewriteTo: null };
  if (r.storedId && r.storedId !== r.makeupClassId) return { pass: false, rewriteTo: null };
  if (!r.makeupLive) return { pass: false, rewriteTo: null };
  return { pass: true, rewriteTo: r.sentAt || r.storedId === r.makeupClassId ? null : r.makeupClassId };
}
