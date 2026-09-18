/**
 * 월별 출석부에서 **'반이동' 표식을 떼는 규칙**(순수 · Vitest) — 원장 2026-09-18.
 *
 * ① *"특강 수업은 라벨 붙이지 말것"* — 특강 반([`isSpecialLecture`](../classes/special-lecture)).
 * ② *"이미 듣고 있는 수업이 존재하는 학생인데, 또 다른 수업이 그 사이에 시작과 종료를 한다면, '특강'
 *    수업일 확률이 있으므로 같은 선생님 안에서 수업한다면 '반이동' 라벨을 생략하고 '종강' 라벨만"*.
 *
 * 🔑 ②는 ①의 **탐지 폴백**이다 — 특강인데 토글도 안 켜고 이름에 '특강'도 없는 반이 실제로 있어서,
 *    그런 반이 시작·끝날 때마다 계속 다니는 반 줄까지 「반이동」이 붙는다(원장 캡처: 김지우 3줄 전부).
 * 🔴 **'종강'·'신입'·'퇴원'은 그대로 둔다** — 원장이 지운 것은 「반이동」뿐이고, 종강은 "이 반이 끝났다"는
 *    다른 사실이라 감추면 표가 덜 말한다(②의 *"'종강' 라벨만"*이 그 뜻이다).
 * 🔴 판정 범위는 **그 화면에 함께 선 반**(= 같은 강사의 출석부)이다. 원장의 *"같은 선생님 안에서"*가 그 말이고,
 *    남의 반까지 재료로 끌어오려면 조회가 하나 더 는다(반응속도) — 반별 보기(반 하나)에선 ②가 성립할 수 없어
 *    ①만 남는다. 그건 정상이다.
 * ⚠️ 끝나지 않은 구간(`end == null`)은 ②의 대상이 아니다 — 원장 문장이 *"시작과 **종료**를 한다면"*이다.
 */
import { isSpecialLecture } from "@/features/classes/special-lecture";
import type { EnrollSpan } from "./enrollment-span";

export type TransferBadgeClass = {
  classId: string;
  className: string;
  /** `classes.is_special`(0133a). 모르면 이름 폴백만으로 판정한다. */
  isSpecial?: boolean;
  students: readonly { id: string; spans: readonly EnrollSpan[] }[];
};

/**
 * 이 반의 구간이 **기록된 반이동**인가 — 그렇다면 어떤 추측도 그 표식을 지우지 못한다.
 *
 * 🔑 근거는 `enrollments.is_transferred`(반이동 RPC가 옛 행에 찍는 값)다. 수강 배정 창의 '반이동' 토글과
 *    시간표 드래그가 만드는 이동은 전부 그 RPC를 지나므로, **사람이 반이동이라고 말한 것**은 여기서 걸린다.
 * 🔴 ①특강 ②감싸인 구간은 "모양만 보고 반이동처럼 보이는 것"을 걷어내는 추측이라, 사실과 부딪치면 사실이 이긴다
 *    (원장 2026-09-18 *"이 반이동 기능과 라벨표시 기능을 적절히 배선해서 합리적인 라벨이"*).
 * ⚠️ 나간 쪽(`transferOut`)은 이 반 구간에 바로 찍혀 있고, 들어온 쪽(`transferIn`)은 **다른 반의 옛 구간**이
 *    내 시작일에 끝나 있는 것으로 알아본다(RPC가 `옛 end_date = 새 start_date`로 닫는다).
 */
function hasRecordedTransfer(
  mine: readonly EnrollSpan[],
  others: readonly { spans: readonly EnrollSpan[] }[],
): boolean {
  if (mine.some((s) => s.isTransferred === true)) return true;
  return mine.some((m) => others.some((o) => o.spans.some((s) => s.isTransferred === true && s.end === m.start)));
}

/** `a`가 `b` **안에** 통째로 드는가(같은 날 경계 포함). `a`는 끝난 구간이어야 한다. */
function containedIn(a: EnrollSpan, b: EnrollSpan): boolean {
  if (!a.end) return false;
  if (b.start > a.start) return false;
  return b.end == null || b.end >= a.end;
}

/**
 * '반이동' 표식을 뗄 `${classId}\t${studentId}` 집합.
 * @param classes 그 화면에 함께 선 반 전부(같은 강사의 출석부).
 */
export function suppressedTransferRows(classes: readonly TransferBadgeClass[]): Set<string> {
  const out = new Set<string>();
  // 학생 → (반, 구간) — ②의 "다른 반" 재료.
  const byStudent = new Map<string, { classId: string; spans: readonly EnrollSpan[] }[]>();
  for (const c of classes) {
    for (const s of c.students) {
      const list = byStudent.get(s.id) ?? [];
      list.push({ classId: c.classId, spans: s.spans });
      byStudent.set(s.id, list);
    }
  }
  for (const c of classes) {
    const special = isSpecialLecture({ isSpecial: c.isSpecial, className: c.className });
    for (const s of c.students) {
      const others = (byStudent.get(s.id) ?? []).filter((o) => o.classId !== c.classId);
      // 🔴 **기록된 반이동이면 아무것도 지우지 않는다** — 추측이 사실을 덮으면 안 된다.
      if (hasRecordedTransfer(s.spans, others)) continue;
      if (special) {
        out.add(transferRowKey(c.classId, s.id));
        continue;
      }
      // 이 반의 **끝난** 구간이 다른 반 구간 안에 통째로 들면 특강으로 본다.
      const inside = s.spans.some((mine) => others.some((o) => o.spans.some((his) => containedIn(mine, his))));
      if (inside) out.add(transferRowKey(c.classId, s.id));
    }
  }
  return out;
}

export function transferRowKey(classId: string, studentId: string): string {
  return `${classId}\t${studentId}`;
}
