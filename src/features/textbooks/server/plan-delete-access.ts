import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";

/**
 * 교재목록 '반 배정' 면에서 [배정 삭제]를 **그릴** 반 — 서버 `deleteClassTextbookPlan`·`undoPlanDelete`가 지나는
 * **같은 게이트**(`requireEcsClassAccess(classId, { write: true })`)를 반마다 그대로 부른다.
 *
 * 🔴 왜 `canWriteTenant("textbooks")`가 아닌가: 배정 삭제의 권한은 교재 마스터가 아니라 **그 반의 ECS 쓰기**다
 *    (plan-actions.ts 머리 주석 — 교재를 못 고치는 담임 강사도 자기 반 배정은 지운다). 화면이 다른 키를 보면
 *    "보이는데 눌러야 거절"이 다시 생긴다(원장 2026-11-05 — 예전엔 판정 없이 열람자 전원에게 떴다, write-lock.ts).
 * 비용: ECS 읽기·담당 밖 반은 반 행 조회 **전에** 거절되지만, 쓰기 권한자(원장·관리자 등)는 반마다 `classes` 조회가
 *    한 번씩 나간다(배정이 걸린 영어 반 수만큼, 병렬). 배정 면을 열 때만 부른다. 반이 많아져 느려지면 같은 조건의
 *    일괄 판정을 access.ts 옆에 둘 것(2026-11-05 리뷰).
 * 실패: 한 반의 판정이 예외를 던져도 그 반만 '단추 없음'으로 둔다 — 배정 면 전체가 오류 화면이 되지 않게.
 */
export async function planDeletableClassIds(classIds: readonly string[]): Promise<string[]> {
  const unique = [...new Set(classIds)];
  const verdicts = await Promise.all(
    unique.map(async (classId) =>
      requireEcsClassAccess(classId, { write: true })
        .then((r) => (r.ok ? classId : null))
        .catch((e) => {
          unstable_rethrow(e); // Next 흐름 신호(redirect·notFound 등)는 삼키지 않는다
          return null;
        }),
    ),
  );
  return verdicts.filter((id): id is string => id !== null);
}
