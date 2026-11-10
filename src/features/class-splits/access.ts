/**
 * 수업 나누기 자격 — **원장 역할 + 학원 설정 '역할·권한'의 개인별 기능 권한에서 지정한 사람**
 * (`permissions.specialAccess.classSplitterIds`).
 *
 * 원장 2026-10-06: *"나누는 건 부원장, 관리자 등 매우 상급자만"* → 역할(관리자)로 주면 데스크 직원까지 열린다는 설명을 듣고
 * 명단을 골랐고, 같은 날 *"전부다 역할 권한을 기본으로 … 필요한건 개인 권한을 따로 편집기에서"* · *"개인 역할은 전부다 편집기"*.
 * 전에는 이 파일이 계정 명단 다섯을 들고 있었다 — 그중 넷이 원장 역할이라 **원장 역할은 기본으로 열고**, 나머지는 화면에서 지정한다.
 *
 * 🔴 여기에 계정 명단을 다시 만들지 말 것(가드: rules.test.ts).
 * 🔑 운영 계정은 자동 통과(원장 2026-08-13 *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"*).
 * ⚠️ 시간표 팝업(보이기)과 서버 액션(쓰기)이 같은 함수를 통과한다([[#77]]) — 실제 호출은 `canSplitClassNow()`(server/gate.ts).
 */
import type { SystemRole } from "@/lib/permissions";

export const CLASS_SPLIT_DENIED_MSG = "수업 나누기는 지정된 계정만 할 수 있습니다";

/**
 * 🔴 **기능 스위치 — 지금은 꺼 둠**(원장 2026-10-06 *"나눔 이거 기능 일단 숨겨서 못쓰게 하고"*). 끄면 시간표 팝업의
 * `수업 나누기` 전환·반 블록 나누기·서버 저장/해제가 전부 닫힌다(모두 이 게이트를 지난다, [[#77]]). 표·출석부 배선은 남아 있지만
 * 나눔 행이 0건이면 아무 화면도 바뀌지 않는다. 다시 열 땐 이 값만 true로.
 * 꺼져 있는 동안 역할·권한 면의 '수업 나누기' 담당자 칸도 서지 않는다(저장값은 그대로 실려 간다 — 다시 켜면 그 사람들이 그대로 보인다).
 */
export const CLASS_SPLIT_ENABLED = false;

/** 나누기 게이트(순수). `enabled`는 시험이 켜진 규칙을 늘 돌려 보도록 주입한다(기본 = 스위치 · 리뷰 A7). */
export function canSplitClass(
  user: { id: string; systemRole: SystemRole },
  policy: { isSuperAdmin: boolean; splitterIds: readonly string[] },
  enabled: boolean = CLASS_SPLIT_ENABLED,
): boolean {
  if (!enabled) return false;
  if (policy.isSuperAdmin || user.systemRole === "master") return true;
  // 저장값은 스키마를 거치지 않고 읽힌다 — 목록이 아니면(손으로 넣은 값) 지정된 사람이 없는 것으로 본다.
  return Array.isArray(policy.splitterIds) && policy.splitterIds.includes(user.id);
}
