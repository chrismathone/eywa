/**
 * 교재 발송 다이얼로그의 **알림장(과목 보드) 기본값** — 순수 함수(클라·서버 공용, server-only/use client 금지).
 *
 * 배경(실사고 2026-10-02 김지우): 두 과목을 다 듣는 학생은 기본값이 **가나다순 첫 과목**(english)이었다.
 * 수학 선생님이 그대로 보내면 수학 교재 안내가 영어 알림장으로 간다 — 영어 1인 보드에 원아가 없으면 "발송 실패"로 드러나지만,
 * 원아가 있으면 **조용히 성공**한다(실측: 수학 교재 2건이 `(영어)` 보드로 나갔다).
 *
 * 규칙: 요청서의 주인(그 요청을 낸 선생님)이 **그 학생을 가르치는 과목**의 알림장.
 *  ① 학생의 발송 가능 과목이 하나면 그것.
 *  ② 주인이 맡은 그 학생의 반(담임·교시 담당)이 한 보드로 모이면 그 보드.
 *  ③ ②로 못 정하면 주인의 담당 과목(`users.subjects`)이 학생 보드 중 하나와만 겹칠 때 그 보드.
 *  ④ 그래도 못 정하면 **고르지 않는다**(null) — 화면이 선택을 요구한다. 틀린 보드로 보내는 것보다 한 번 고르게 하는 쪽이 낫다.
 */

export type NoticeClassTeacher = {
  /** 그 학생이 다니는 반의 과목 */
  subject: string;
  /** 그 반의 담임과 지금 유효한 교시 담당(계정 id) */
  teacherIds: string[];
};

export type NoticeOwner = {
  id: string;
  /** 담당 과목(`users.subjects`) */
  subjects: string[];
};

export function defaultNoticeSubject({
  subjects,
  classes,
  owners,
  boardOf,
}: {
  /** 학생의 발송 가능 과목(보드가 같은 과목은 하나로 접힌 목록) */
  subjects: string[];
  classes: NoticeClassTeacher[];
  /** 요청서 주인 후보 — 작성자 계정, 요청서에 적힌 담임 이름과 같은 계정 */
  owners: NoticeOwner[];
  /** 과목 키 → 보드 접두사(같은 보드로 가는 과목을 한 묶음으로 본다) */
  boardOf: (subject: string) => string | undefined;
}): string | null {
  if (subjects.length <= 1) return subjects[0] ?? null;
  const subjectOfBoard = (board: string) => subjects.find((s) => boardOf(s) === board) ?? null;
  const only = (boards: Set<string>) => (boards.size === 1 ? subjectOfBoard([...boards][0]!) : null);
  const studentBoards = new Set(subjects.map(boardOf).filter((b): b is string => !!b));

  const ownerIds = new Set(owners.map((o) => o.id));
  const taught = new Set<string>();
  for (const c of classes) {
    const board = boardOf(c.subject);
    if (board && studentBoards.has(board) && c.teacherIds.some((id) => ownerIds.has(id))) taught.add(board);
  }
  const byClass = only(taught);
  if (byClass) return byClass;
  if (taught.size > 1) return null; // 주인이 두 과목을 다 가르친다 — 어느 교재인지 여기서는 알 수 없다

  const bySubject = new Set<string>();
  for (const o of owners) {
    for (const s of o.subjects) {
      const board = boardOf(s);
      if (board && studentBoards.has(board)) bySubject.add(board);
    }
  }
  return only(bySubject);
}

/** 주인 판정에 쓰는 계정 한 줄(같은 지점 · 재직). */
export type OwnerAccount = { id: string; displayName: string; subjects: string[]; role: string };

/**
 * 요청서 한 건의 주인 후보.
 *  - 요청서에 적힌 담임 이름과 같은 재직 계정이 **하나**면 그 계정(이름이 주인이다 — 대리 작성, textbook-ownership.ts).
 *  - 이름이 비었거나, 이름이 작성자 자신을 가리키면(같은 이름 계정이 여럿이어도 그 안에 작성자가 있으면) 작성자.
 *  - 🔴 이름이 **다른 사람**을 가리키는데 계정을 못 찾았으면(별칭·퇴사자·동명이인) 아무도 주인이 아니다 — 작성자로 넘기지 않는다.
 *    넘기면 동료가 대신 낸 요청이 작성자 과목으로 굳는다(영어 선생님 앞으로 낸 요청을 수학 담임이 작성 → 수학 알림장).
 *  - 주인으로 정한 계정이 강사가 아니면(이름으로 찾았든 작성자든) 담당 과목(③)은 쓰지 않는다 — 사무실 계정의 과목 칸으로 알림장을 정하지 않는다(반 담당 ②는 그대로).
 */
export function resolveNoticeOwners(
  order: { teacherName: string | null; createdBy: string | null },
  accounts: OwnerAccount[],
): NoticeOwner[] {
  const name = order.teacherName?.trim() ?? "";
  const named = name ? accounts.filter((a) => a.displayName.trim() === name) : [];
  if (named.length === 1) return [toOwner(named[0]!)];
  const creator = order.createdBy ? accounts.find((a) => a.id === order.createdBy) : undefined;
  if (!creator) return [];
  if (name && !named.some((a) => a.id === creator.id)) return [];
  return [toOwner(creator)];
}

/** 강사가 아닌 계정(사무실·관리자)의 담당 과목 칸으로는 알림장을 정하지 않는다 — 어느 길로 주인이 됐든 같다. */
const toOwner = (a: OwnerAccount): NoticeOwner => ({ id: a.id, subjects: a.role === "teacher" ? a.subjects : [] });

/**
 * 발송 창의 알림장 초기 선택 — 학생별로 **그 학생 요청서들의 기본값이 전부 같을 때만** 채운다.
 * 한 건이라도 못 정했거나(null) 서로 다르면 비워 둔다(한 학생의 여러 요청은 한 글로 나가므로 첫 건의 과목으로 묶어 보내지 않는다).
 */
export function initialNoticePicks(orders: Array<{ studentId: string | null; defaultSubject: string | null }>): Record<string, string> {
  const seen = new Map<string, Set<string | null>>();
  for (const o of orders) {
    if (!o.studentId) continue;
    if (!seen.has(o.studentId)) seen.set(o.studentId, new Set());
    seen.get(o.studentId)!.add(o.defaultSubject ?? null);
  }
  const out: Record<string, string> = {};
  for (const [studentId, set] of seen) {
    const [only] = [...set];
    if (set.size === 1 && only) out[studentId] = only;
  }
  return out;
}
