/**
 * 수업 나누기 자격 — **이름이 적힌 사람만**(원장 2026-10-06: *"나누는 건 부원장, 관리자 등 매우 상급자만"* →
 * 역할(admin)로 주면 데스크 직원까지 열린다는 설명을 듣고 **B안(명단)** 선택 → *"명단은 기존에 자주 나왔던 예외인들만"*).
 *
 * 🔑 명단 = 급여명세서 열람 명단(`payslip-access.ts`)과 **같은 다섯 명** — 원장이 가리킨 "자주 나온 예외인"이다.
 *    ⚠️ 그래도 **복사본을 둔다**(그쪽을 import하지 않는다): 급여명세서 명단이 바뀔 때 이 권한이 조용히 따라
 *    움직이면 안 된다. 사람이 바뀌면 **여기 한 곳**만 고친다(시간표 팝업·서버 액션이 같은 함수를 통과한다, [[#77]]).
 * 🔑 user id로 잠근다(개명·동명이인에 안 흔들린다 — payslip-access.ts와 같은 규약).
 * 🔑 super_admin은 자동 통과(원장 2026-08-13 *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"*).
 * ⚠️ 침산이 아닌 학원(일반판)은 명단을 설정할 화면이 아직 없어 **원장(master)만** 연다 — 넓히지 않는 쪽으로.
 */
import type { SystemRole } from "@/lib/permissions";

/** 나누기 허용 계정. 주석의 이름·역할은 2026-10-06 기준(설명용이며 판정에 쓰지 않는다). */
export const CLASS_SPLITTER_USER_IDS: readonly string[] = [
  "fcf735fa-edf7-4095-8fa6-724285a018ed", // 박소선 (master)
  "94007db7-12d3-4b5d-97f2-39071446536b", // 원일 (master)
  "44626c09-22d9-445f-a350-b792d6afdf75", // 설현 (admin)
  "8bb70f71-a8c3-450c-9236-561e9b43ca4f", // 김예원 (admin)
  "477950d4-9cb0-4c02-9ac4-f00d42754d55", // 이승엽 (admin · super_admin)
];

export const CLASS_SPLIT_DENIED_MSG = "수업 나누기는 지정된 계정만 할 수 있습니다";

/** 나누기 게이트(순수) — 실제 호출은 `canSplitClassNow()`(server/gate.ts)가 super_admin·학원 판정을 채워 부른다. */
export function canSplitClass(
  user: { id: string; systemRole: SystemRole },
  policy: { isSuperAdmin: boolean; isChinsanTenant: boolean },
): boolean {
  if (policy.isSuperAdmin) return true;
  return policy.isChinsanTenant ? CLASS_SPLITTER_USER_IDS.includes(user.id) : user.systemRole === "master";
}
