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
 *    (send-class.test.ts가 같은 표를 고정한다).
 */

export const SEND_CLASS_SUBJECTS: ReadonlySet<string> = new Set(["math", "subject_1"]);

/**
 * 반별 발송이 **이 학원에서** 켜져 있는가 — ClassNote 기능(모듈)이 켜진 학원이면 수학은 **늘 반별**이다.
 * 원장 2026-09-30: ClassNote 관련 기능은 ClassNote를 쓰는 학원에만. 모듈이 꺼져 있으면 반 고르기·'보낼 반 없음' 차단이
 * **전부 없다**(예전 그대로). 발송 경로의 모든 판정은 이 함수를 지난다(원스크린·관리자 직접 작성·관리자 일괄 발송).
 * 🔴 2026-11-05 원장 *"이제 안쓰는 기능들 정리하고 반 보드 동기화만 남기면 될듯"* — 옛 보고서 설정 '수학 발송 경로'
 *    (기존 방식 = 1인 보드 · 일부 선생님만 반별)를 걷었다. 워커 [`class-route-decide.mjs`](../../../scripts/_classnote/class-route-decide.mjs)
 *    `decideRoute`도 수학이면 늘 반별이다(같은 규칙 — send-class.test.ts가 함께 고정한다).
 * 인자는 설정 하나뿐이다 — 옛 '일부 선생님만' 판정 자리였던 둘째 인자(강사 이름)와 공지 경로의 `senderName`은 호출부와 함께 걷었다(2026-11-05).
 */
export function classRouteActive(settings: { modules?: { disabled?: readonly string[] | null } | null }): boolean {
  return !(settings.modules?.disabled ?? []).includes("classnote");
}

/**
 * 이 보고서에 '보낼 반'이 필요한가 — 수학 · 반별 경로(ClassNote 모듈 켜짐)이면서
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

/** 반별 발송 대상 수학 행인가(ClassNote 모듈 켜짐 + 수학) — 보낼 반 게이트를 태울 행. */
export function isSendClassRouteRow(
  settings: Parameters<typeof classRouteActive>[0],
  r: { subject?: unknown; teacher_name?: unknown },
): boolean {
  return SEND_CLASS_SUBJECTS.has((r.subject as string | null) ?? "") && classRouteActive(settings);
}

/** 보낼 반이 없어 발송을 막을 때의 안내(원장 2026-09-30 *"담당 반이 없으면 보고서 발송 불가능하게"*) — 서버·화면 한 벌. */
export const NO_SEND_CLASS_ERROR = "보낼 반이 없어 발송할 수 없습니다 — 이 학생의 반을 확인하세요(담당 반이 아니거나 반 보드가 없는 학생)";

/**
 * 정규 보고서(반 있음)의 반 보드가 없어졌을 때 — **다른 반으로 보내지 않고 막는다**(원장 결정 4, 2026-09-30).
 * 까닭을 가리지 못했을 때의 안내다 — 가릴 수 있으면 `boardMissingNotice`가 까닭에 맞는 문장을 준다.
 */
export const BOARD_MISSING_ERROR =
  "이 반의 ClassNote 반 보드가 없어 발송하지 않았습니다(다른 반으로 보내지 않습니다) — 관리자에게 '지금 반 보드 동기화'(수업보고서 발송 큐)를 부탁한 뒤 다시 보내 주세요. 저장은 됐습니다";

/**
 * 정규 보고서가 "이 학생이 받을 반 보드가 없다"로 막힌 **까닭**(순수) — 원장 2026-10-03 *"선생님이 동기화 기능이 생기고나서 되지않는다고
 * 생각할만한 기능"* → *"해결가능한건 해결하는 방향으로"*. 예전엔 까닭이 무엇이든 "반 보드가 없어 … 관리자에게 부탁"만 떴다.
 *  · `enrolling`     = 지금 그 반에 다니는데 이 학생만 반 보드 기록이 없다(방금 배정된 신입·반 이동 — 동기화가 돌면 풀린다)
 *  · `class_pending` = 그 반의 반 보드 연결 자체가 아직 없다(새 반 — 동기화가 만든다. 같은 이름 보드가 있으면 못 만든다)
 *  · `hold_join`     = 배정 보류 — 학부모가 ClassNote에 가입하지 않았다(가입하면 풀린다)
 *  · `hold_other`    = 배정 보류 — 그 밖의 사유(생년·전화·이름 불일치, 원아 중복 … 사람이 확인해야 풀린다)
 *  · `left`          = 그 반 수강이 끝나 반 보드에서 빠졌다(다시 생기지 않는다 — 다른 반으로 보내지 않는다)
 *  · `unknown`       = 그 밖 — 옛 안내 그대로(동기화 대상이 아닌 반·학생, 연결은 있는데 반 전체 기록이 빈 반 = 보드가 지워졌거나
 *                      특정 불가, 기록이 전부 ok인데 막힘, 그 반에 다닌 적 없음)
 * 🔴 "기다리면 풀린다"고 말하려면 **동기화가 실제로 그 학생을 넣을 수 있어야** 한다 — `syncTarget`은 워커의 대상 기준
 *    (`targetClassWhere`·`currentEnrollmentOn`: 활성·보고서 발송·수학·종강 전 반 + 재원·테스트 아님 학생)과 같아야 하고(2026-11-04 원장
 *    지시로 워커도 다시 보고서 발송 반만 동기화한다 — 11-03 'JJ 맞춤' 되돌림),
 *    `liveNow`는 그 날짜 기준(시작일 ≤ 오늘 ≤ 종료일)과 같아야 한다. 어긋나면 "배정을 요청했습니다"가 거짓말이 된다.
 */
export type BoardMissingKind = "enrolling" | "class_pending" | "hold_join" | "hold_other" | "left" | "unknown";

/** 배정 보류 사유(연동 PC가 적은 문장) — "다음 동기화 때 배정"은 보류가 아니라 배정 중이다. */
const ASSIGN_PENDING_REASON = /^반 보드 배정 전/;
/**
 * 학부모 가입이 끝나면 풀리는 보류 사유(연동 PC class-board-plan.mjs `resolveStudentChildren`이 적는 문장의 머리).
 *  · 지금 문장(2026-11-02~) = `JOIN_WAIT_REASON` 'ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음'(1인 보드·반 보드 확인 기록·
 *    원아 연결 어디에도 원아가 없다 — 가입하면 원아 연결이 생기고 다음 동기화가 배정한다)
 *  · 옛 문장 둘 = '1인 보드 없음' · 'ClassNote 미가입·미배정(1인 보드 원아 0명)' — 연동 PC가 바뀌기 전·기록이 다시 쓰이기 전 줄
 * 🔴 둘 다 알아본다(앱과 연동 PC 중 무엇이 먼저 배포돼도 '가입 대기'가 '관리자 확인'으로 떨어지지 않게). 원아 연결이 있는데
 *    가드(전화·생년·이름)에 걸린 보류는 이 머리로 시작하지 않는다 = 관리자 확인. 잠금 = board-missing.test.ts.
 */
const JOIN_HOLD_REASON = /^(1인 보드 없음|ClassNote 미가입)/;
/** 워커가 사유 여러 개를 잇는 글자(math-class-boards-db.mjs `h.reasons.join(" / ")`) — 사유가 둘 이상이면 가입만으로 풀리지 않는다. */
const REASON_JOINER = " / ";

export function classifyBoardMissing(a: {
  /** 오늘 그 반에 다니는가(동기화 대상 날짜 기준) */
  liveNow: boolean;
  /** 그 반 수강이 끝난 기록이 있는가 */
  ended: boolean;
  /** 반·학생이 동기화 대상인가(활성·발송·수학·종강 전 반 + 재원·테스트 아님 학생) */
  syncTarget: boolean;
  /** 그 반의 반 보드 연결(0302a)이 있는가 */
  classLinked: boolean;
  /** 그 반 전체의 반 보드 기록 수(다른 학생 포함) */
  classMemberCount: number;
  /** 이 학생의 그 반 보드 기록 상태들 — 없으면 빈 배열 */
  memberStatuses: readonly (string | null)[];
  /** 보류 기록의 사유 문장 */
  holdReason?: string | null;
}): BoardMissingKind {
  if (!a.liveNow) return a.ended ? "left" : "unknown";
  if (!a.syncTarget) return "unknown";
  if (a.memberStatuses.some((s) => s !== "ok")) {
    const reason = (a.holdReason ?? "").trim();
    if (ASSIGN_PENDING_REASON.test(reason)) return "enrolling";
    return JOIN_HOLD_REASON.test(reason) && !reason.includes(REASON_JOINER) ? "hold_join" : "hold_other";
  }
  // 기록이 전부 ok인데도 막혔다 = 학생이 아니라 반 쪽 문제 — 기다려서 풀리는 일이 아니다.
  if (a.memberStatuses.length) return "unknown";
  if (!a.classLinked) return "class_pending";
  // 연결은 있는데 반 전체 기록이 비었다 = ClassNote에서 보드가 지워졌거나 특정할 수 없는 반(동기화가 그 반 기록을 통째로 비운다).
  if (a.classMemberCount <= 0) return "unknown";
  return "enrolling";
}

/** 화면이 문장을 고르는 결과 코드 — 강사뷰는 이 코드로 사전(os.c.*)을 탄다. */
export type BoardMissingStatus =
  | "board_enrolling"
  | "board_enrolling_auto"
  | "board_class_pending"
  | "board_hold_recheck"
  | "board_hold"
  | "board_hold_admin"
  | "board_left"
  | "board_missing";

/** 기다리면 풀릴 수 있는 까닭인가 — 그 반·학생의 동기화를 요청할 값어치가 있다. */
export function boardMissingWorthSync(kind: BoardMissingKind): boolean {
  return kind === "enrolling" || kind === "class_pending" || kind === "hold_join";
}

type BoardMissingNotice = { status: BoardMissingStatus; error: string; /** 보류일 때 안내에 넣은 사유 문장(강사뷰 사전의 `{reason}`) */ holdReason?: string };

/**
 * 까닭 → 결과 코드와 안내 문장(순수 · 서버·관리자 화면의 한국어). `requested` = 그 반·학생의 동기화가 **실제로 요청돼 있는가**.
 * 🔴 약속은 사실만 — 요청하지 못했으면(쿨다운·연동 PC 꺼짐) "요청했습니다"라고 쓰지 않는다. '배정 중'의 "자동으로 배정됩니다"는
 *    매일 새벽 정기 동기화가 근거다(낮의 자동 동기화가 꺼져 있어도 참). 새 반은 요청하지 못했으면 옛 안내로 둔다
 *    (같은 이름 보드 때문에 영영 못 만드는 반일 수 있어 "자동으로"를 약속하지 않는다).
 */
export function boardMissingNotice(kind: BoardMissingKind, requested: boolean, holdReason?: string | null): BoardMissingNotice {
  if (kind === "enrolling")
    return requested
      ? {
          status: "board_enrolling",
          error:
            "이 학생은 아직 이 반의 ClassNote 반 보드에 배정되지 않았습니다 — 지금 배정을 요청했습니다. 몇 분 뒤 다시 보내 주세요(계속 안 되면 관리자에게 알려 주세요). 저장은 됐습니다",
        }
      : {
          status: "board_enrolling_auto",
          error:
            "이 학생은 아직 이 반의 ClassNote 반 보드에 배정되지 않았습니다 — 배정은 자동으로 진행됩니다(늦어도 다음 날 새벽). 배정된 뒤 다시 보내 주세요. 저장은 됐습니다",
        };
  if (kind === "class_pending" && requested)
    return {
      status: "board_class_pending",
      error:
        "이 반의 ClassNote 반 보드가 아직 없습니다 — 지금 만들기를 요청했습니다. 몇 분 뒤 다시 보내 주세요(계속 안 되면 관리자에게 알려 주세요 — 같은 이름의 보드가 이미 있으면 자동으로 만들지 않습니다). 저장은 됐습니다",
    };
  if (kind === "hold_join") {
    const why = boardHoldReasonText(holdReason);
    return requested
      ? {
          status: "board_hold_recheck",
          holdReason: why,
          error: `이 학생은 이 반의 ClassNote 반 보드 배정이 보류돼 있습니다(${why}) — 지금 다시 확인을 요청했습니다. 몇 분 뒤 다시 보내 보고, 그래도 안 되면 학부모의 ClassNote 가입 여부를 확인해 주세요. 저장은 됐습니다`,
        }
      : {
          status: "board_hold",
          holdReason: why,
          error: `이 학생은 이 반의 ClassNote 반 보드 배정이 보류돼 있습니다(${why}) — 학부모의 ClassNote 가입 여부를 확인해 주세요. 가입이 끝나면 자동으로 배정됩니다. 저장은 됐습니다`,
        };
  }
  if (kind === "hold_other") {
    const why = boardHoldReasonText(holdReason);
    return {
      status: "board_hold_admin",
      holdReason: why,
      error: `이 학생은 이 반의 ClassNote 반 보드 배정이 보류돼 있습니다(${why}) — 관리자 확인이 필요합니다. 저장은 됐습니다`,
    };
  }
  if (kind === "left")
    return {
      status: "board_left",
      error: "이 학생은 이 반 수강이 끝나 ClassNote 반 보드에 없습니다 — 이 반으로는 보낼 수 없습니다(다른 반으로 보내지 않습니다). 저장은 됐습니다",
    };
  return { status: "board_missing", error: BOARD_MISSING_ERROR };
}

/**
 * 미리 보기(관리자 직접 작성의 '보낼 반' 칸)의 안내 — 아직 보내려 한 것이 아니라 요청하지 않았다. 요청할 값어치가 있는 까닭이면
 * "발송을 누르면 요청한다"고 알리고(발송 버튼을 잠그지 않는다 — 서버가 막으면서 요청한다), 아니면 발송 때와 같은 문장이다.
 */
export function boardMissingPreview(kind: BoardMissingKind, holdReason?: string | null): string {
  if (kind === "enrolling")
    return "이 학생은 아직 이 반의 ClassNote 반 보드에 배정되지 않았습니다 — 발송을 누르면 지금 배정을 요청합니다(배정된 뒤 다시 보내면 나갑니다).";
  if (kind === "class_pending")
    return "이 반의 ClassNote 반 보드가 아직 없습니다 — 발송을 누르면 지금 만들기를 요청합니다(만들어진 뒤 다시 보내면 나갑니다).";
  if (kind === "hold_join")
    return `이 학생은 이 반의 ClassNote 반 보드 배정이 보류돼 있습니다(${boardHoldReasonText(holdReason)}) — 발송을 누르면 다시 확인을 요청합니다. 학부모의 ClassNote 가입 여부도 확인해 주세요.`;
  return boardMissingNotice(kind, false, holdReason).error;
}

/**
 * 보류 사유(연동 PC가 적은 한국어 문장)를 안내에 넣을 모양으로 — 비었으면 흔한 까닭을 적는다. 내부 번호(`(id 123)`·`(#1317083)`·
 * `#1317083`)는 뺀다(화면에 뜻 없는 숫자) · 줄바꿈은 한 칸 · 길이는 자른다.
 */
export function boardHoldReasonText(reason: string | null | undefined): string {
  const r = (reason ?? "")
    .replace(/\((?:id\s*|#)\d+\)/gi, "")
    .replace(/#\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return r ? (r.length > 80 ? `${r.slice(0, 80)}…` : r) : "학부모의 ClassNote 가입·원아 확인이 끝나지 않았습니다";
}

/** 반 보드가 없어 막힌 결과 코드인가(여덟 가지 전부) — 화면·일괄 발송 집계가 쓴다. */
export function isBoardMissingStatus(status: string | null | undefined): status is BoardMissingStatus {
  return (
    status === "board_enrolling" ||
    status === "board_enrolling_auto" ||
    status === "board_class_pending" ||
    status === "board_hold_recheck" ||
    status === "board_hold" ||
    status === "board_hold_admin" ||
    status === "board_left" ||
    status === "board_missing"
  );
}

/** 반 보드에 배정되면 다시 보낼 수 있는 결과인가(배정·만들기·재확인을 요청했거나 자동으로 진행 중) — 일괄 발송이 '실패'로 세지 않는다. */
export function isBoardWaitStatus(status: string | null | undefined): boolean {
  return status === "board_enrolling" || status === "board_enrolling_auto" || status === "board_class_pending" || status === "board_hold_recheck";
}

/** 사람이 풀어야 하는 막힘인가(보류·반을 떠남) — 일괄 발송이 '보낼 반 없음'으로 센다. */
export function isBoardBlockedStatus(status: string | null | undefined): boolean {
  return status === "board_hold" || status === "board_hold_admin" || status === "board_left";
}

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
