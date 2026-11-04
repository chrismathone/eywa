// scripts/_classnote/homonym-phone-gate.mjs — 1인 보드 발송의 **동명이인 보호자 전화 대조**(순수, 개명 감사 G5 2026-09-30).
//
// 1인 보드 레일은 이름이 모호할 때(같은 이름 2명+·접미사 형제) 원아 **생년만** 봤다. 같은 학년 동명이인이면 생년이 통과해
// 다른 집으로 간다(학생 이름을 다른 학생 이름으로 바꾼 날). 반 보드 레일처럼 보호자 전화를 함께 본다.
// 🔴 막는 것은 **확실히 다를 때만**(양쪽 번호가 다 있고 불일치) — 번호를 모르면 종전대로 둔다(정상 발송을 멈추지 않는다).
//    한 아이를 보호자·학생이 각자 등록한 2계정(안은지·박세욱)은 두 번호가 모두 aywa 4칸 안에 있어 그대로 통과한다.
// 🔴 보호자 전화 **값**은 사유에 싣지 않는다(일치 여부만).
import { carerPhones, phoneMatches } from "./offboard-safety.mjs";

/**
 * @param {{ studentPhones: Array<string|null|undefined>, children: Array<{id:number, name?:string}>, admissions: Map<number, {phone:string|null, phones?:Array<string|null>}> | null }} a
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function homonymPhoneGate({ studentPhones, children, admissions }) {
  if (!admissions) return { ok: true }; // 명부를 못 읽었으면 종전(생년 대조)만 — 여기서 새로 막지 않는다
  // 보호자 전화 전부(carer1~N · 원장 2026-11-04) — 한 보호자만 보면 엄마·아빠 번호가 갈린 같은 집을 '다른 집'으로 막는다.
  const mismatched = (children ?? []).filter((c) => phoneMatches(studentPhones ?? [], carerPhones(admissions.get(c.id))) === false);
  if (!mismatched.length) return { ok: true };
  return {
    ok: false,
    reason: `동명이인이 있는 이름인데 보드 원아 ${mismatched.map((c) => `"${c.name ?? "?"}"`).join(", ")}의 보호자 전화가 이 학생과 다릅니다 — 다른 집일 수 있어 보류(클래스노트에서 같은 집임을 확인했으면 보고서 설정의 '발송 보류 예외'에 보드를 등록하면 풀립니다)`,
  };
}
