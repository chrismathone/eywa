/**
 * **강사 전체 보기의 반 목록** — 출석부 화면과 프리랜서 명세서가 같은 목록을 본다(순수 · Vitest).
 *
 * 🔑 왜 한 곳인가: 명세서의 수업료는 그 강사 출석부의 실급여 합계다(원장 2026-10-06 *"전부 통일 출석부 그대로"*).
 *    반 목록을 두 벌로 짜면 한쪽만 고쳐지는 날 화면 합계와 명세서 금액이 갈린다 — 돈 화면에서 가장 나쁜 종류의 버그다.
 *
 * 목록 = 그 강사가 **가르치는 반**(담임 ∪ 그 기간 교시 담당 ∪ 그 기간의 이전 담임) 가운데,
 *        조회 기간이 끝난 **뒤에** 담임이 된 반을 뺀 것([`homeroomStartsAfter`](./homeroom-window.ts)).
 */
import { homeroomSinceOf, homeroomTeachersInRange, type HomeroomPeriod, type HomeroomSinceIndex } from "@/features/classes/teacher-as-of";
import { homeroomStartsAfter } from "./homeroom-window";
import { classTeacherRole, type ClassTeacherRole } from "@/features/attendance/teacher-axis";

/** 판정에 필요한 칸만 — 출석부 반 목록(`AttendanceMatrix["classes"]`)이 그대로 들어온다. */
export type SheetClassAxis = {
  id: string;
  teacherId: string | null;
  slotTeachers: readonly { id: string }[];
  historicalTeachers?: readonly { id: string }[];
  homeroomHistory?: readonly HomeroomPeriod[];
};

/** 이 강사가 이 반을 가르치나 — 담임 · 그 기간 교시 담당 · 그 기간의 이전 담임. */
export function classTaughtBy(c: SheetClassAxis, teacherId: string): boolean {
  return (
    classTeacherRole({
      homeroomTeacherId: c.teacherId,
      slotTeacherIds: c.slotTeachers.map((t) => t.id),
      teacherId,
    }) !== null || !!c.historicalTeachers?.some((t) => t.id === teacherId)
  );
}

export type TeacherSheetClasses<C> = {
  /** 가르치는 반 전부(거르기 전) — 역할·담임 시작일은 이 목록 기준으로 준다. */
  taught: C[];
  /** 반별 역할(담임 / 교시 담당 / 겸임). 이전 담임으로만 잡힌 반은 null. */
  roles: Map<string, ClassTeacherRole | null>;
  /** 담임 폴백 반의 담임 시작일 — 근거(인수인계 기록)가 없으면 null. */
  sinceByClass: Map<string, string | null>;
  /** 표에 서는 반 — 조회 기간 뒤에 담임이 된 반을 뺀 것. */
  classes: C[];
  /**
   * 표에 선 반 가운데 **담임이 바뀐 반** — 이 표가 금액(프리랜서 명세서)이 될 때 "상대 선생님 명세서와 겹치거나 빠진 수업이 없는지"를
   * 확인하라고 알리는 재료다(표시 전용 — 어떤 숫자도 이 값을 읽지 않는다).
   *  · `took` = 조회 기간 **도중에** 담임이 됐다(담임 몫 칸은 `since`부터만 이 사람 것이다). 겸임 반도 본다 —
   *    그 반은 담임 시작일을 주지 않지만(직접 맡은 교시는 날짜와 무관) 담임 몫 칸은 똑같이 그날부터다.
   *  · `gave` = 조회 기간에 담임이었는데 **기간 안에 넘겼거나 지금은 담임이 아니다**(넘긴 뒤의 칸은 이 표에 없다).
   *    기간이 끝난 뒤에 넘긴 반도 세운다 — 받은 사람이 티어 정산이면 그 달 전체가 그쪽 명세서에도 들어가 겹친다.
   *  한 반에 한 줄만 준다(받았다가 같은 달에 넘긴 반은 `took`).
   */
  handovers: { classId: string; kind: "took" | "gave"; since: string | null }[];
};

export function teacherSheetClasses<C extends SheetClassAxis>(input: {
  classes: readonly C[];
  teacherId: string | null;
  /** 조회 기간(강사 전체 보기는 달력월). */
  window: { from: string; to: string };
  /** 담임 시작일 인덱스 — null이면 아무것도 빼지 않는다(근거 없음과 같은 폴백). */
  sinceIdx: HomeroomSinceIndex | null;
}): TeacherSheetClasses<C> {
  const { teacherId, window, sinceIdx } = input;
  const taught = teacherId ? input.classes.filter((c) => classTaughtBy(c, teacherId)) : [];
  const roles = new Map<string, ClassTeacherRole | null>(
    taught.map((c) => [
      c.id,
      teacherId
        ? classTeacherRole({ homeroomTeacherId: c.teacherId, slotTeacherIds: c.slotTeachers.map((t) => t.id), teacherId })
        : null,
    ]),
  );
  // 🔴 담임 폴백으로 잡힌 반만 날짜를 준다 — 교시 담당·겸임은 그 사람이 실제로 그날 그 교시를 가르쳤다.
  const sinceByClass = new Map<string, string | null>(
    taught.map((c) => [c.id, sinceIdx && roles.get(c.id) === "homeroom" ? homeroomSinceOf(sinceIdx, c.id, teacherId) : null]),
  );
  const classes = taught.filter(
    (c) =>
      !homeroomStartsAfter(
        sinceByClass.get(c.id),
        window.to,
        // 맡았다 넘겼다 다시 맡은 사람은 앞 구간이 이 기간에 걸릴 수 있다 — 담임 이력으로 한 번 더 본다.
        !!teacherId && homeroomTeachersInRange([...(c.homeroomHistory ?? [])], window.from, window.to).includes(teacherId),
      ),
  );
  /** 기간 첫날 뒤 ~ 말일 사이의 날짜인가 — 첫날에 바뀐 담임은 그 달 전체가 한 사람 몫이라 '도중'이 아니다. */
  const inside = (date: string | null | undefined): date is string => !!date && date > window.from && date <= window.to;
  const handovers = classes.flatMap((c): TeacherSheetClasses<C>["handovers"] => {
    if (!teacherId) return [];
    const history = [...(c.homeroomHistory ?? [])];
    const mine = history.filter((p) => p.teacherId === teacherId);
    // 담임 폴백 반은 시작일 인덱스로, 겸임 반(시작일을 주지 않는다)은 담임 이력의 내 구간으로 본다.
    const since = sinceByClass.get(c.id) ?? null;
    const tookAt = inside(since) ? since : (mine.map((p) => p.from).filter(inside).sort()[0] ?? null);
    if (tookAt) return [{ classId: c.id, kind: "took", since: tookAt }];
    const wasHomeroom = homeroomTeachersInRange(history, window.from, window.to).includes(teacherId);
    // 지금 담임이어도 기간 안에 한 번 넘겼으면(맡았다 넘겼다 다시 맡음) 넘긴 뒤의 칸은 이 표에 없다.
    const gaveInside = mine.some((p) => inside(p.to));
    return (wasHomeroom && c.teacherId !== teacherId) || gaveInside ? [{ classId: c.id, kind: "gave", since: null }] : [];
  });
  return { taught, roles, sinceByClass, classes, handovers };
}
