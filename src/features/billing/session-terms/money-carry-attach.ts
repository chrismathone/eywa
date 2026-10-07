// 금액 이월을 줄에 붙이는 규칙 — 순수 함수(Vitest). 회차 확정 화면(`server/queries.ts`)과 '금액 이월 → 확정 시수 반영'
// (`server/carry-session-sync.ts`)이 **같은 함수**로 받을 줄을 고른다(따로 지으면 화면이 더한 줄과 시수를 올린 줄이 갈린다).
import { carryTargetRank, type CarrySource, type MoneyCarryIn, type MoneyCarryOut } from "./money-carryover";
import { monthRosterKey } from "./month-roster";

/** 붙이는 데 필요한 줄의 최소 모양(회차 확정 행 `SessionTermRow`가 이 모양이다). */
export type CarryAttachRow = CarrySource & {
  id: string;
  studentId: string;
  classId: string | null;
  invoiceId: string | null;
  termState?: string;
  carryOut?: MoneyCarryOut | null;
  carryIns?: MoneyCarryIn[];
};

/**
 * 금액 이월을 행에 붙인다. 받은 이월은 (학생, 받을 반) 줄에 — 그 줄이 이 달에 없으면(반을 그만둠 등) 그 학생의 첫 줄에
 * `orphan`으로 붙여 **보이게만** 한다(어느 반 몫인지 모르니 실납엔 안 더한다 — 조용히 사라지면 돈이 증발한 것처럼 보인다).
 */
export function attachMoneyCarry<T extends CarryAttachRow>(rows: T[], carryOuts: ReadonlyMap<string, MoneyCarryOut>, carryIns: ReadonlyMap<string, MoneyCarryIn[]>): void {
  if (carryOuts.size === 0 && carryIns.size === 0) return;
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    if (r.termState === "term" && carryOuts.has(r.id)) r.carryOut = carryOuts.get(r.id)!;
    if (r.classId) {
      const key = monthRosterKey(r.studentId, r.classId);
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
    }
  }
  // 같은 쌍이 여러 줄(청구서 중복)이면 **한 줄에만** — `carryTargetRank`(받을 수 있는 줄 → 환불 아닌 회차 행 → 가상 행 → 환불 줄) → id 순.
  // 보낸 달 도착 판정(`carryLanding`)과 같은 규칙이다. 두 줄에 붙이면 두 번 더해지고, 배분 없는 줄에 붙으면 분배에 0으로 빠진다.
  for (const [key, list] of carryIns) {
    const target = [...(byKey.get(key) ?? [])].sort((a, b) => carryTargetRank(a) - carryTargetRank(b) || a.id.localeCompare(b.id))[0];
    if (target && carryTargetRank(target) === 3) {
      // 받을 줄이 전부 환불 — 받을 곳이 없다. 보이되 더하지 않고 분배 저장을 막는다(보낸 달도 `orphan`으로 본다).
      target.carryIns = [...(target.carryIns ?? []), ...list.map((c) => ({ ...c, orphan: true, refunded: true }))];
      continue;
    }
    if (target) {
      target.carryIns = [...(target.carryIns ?? []), ...list];
      continue;
    }
    // 받을 줄이 이 달에 없다 — 그 학생의 다른 줄(청구서 있는 줄 먼저)에 **보이게만** 붙인다(실납엔 안 더한다).
    const studentId = key.slice(0, key.indexOf("|")); // monthRosterKey = `학생|반`
    const own = rows.filter((r) => r.studentId === studentId);
    const fallback = own.find((r) => r.invoiceId !== null) ?? own[0];
    if (fallback) fallback.carryIns = [...(fallback.carryIns ?? []), ...list.map((c) => ({ ...c, orphan: true }))];
  }
}
