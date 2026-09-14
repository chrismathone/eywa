import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/batch";

/**
 * **테스트 학생 id 집합**(`students.is_test`, 0141a) — 알림·집계가 공유하는 한 벌.
 *
 * 원장 2026-09-13: *"테스트 계정 알림 전부 off."* ClassNote 발송 시험용 학생 '학원이'는 모든 선생님이
 * 자기 화면에서 테스트할 수 있도록 반에 배정돼 있어서, 알림 경로가 이 학생을 그대로 세면 **가짜 재촉**이
 * 실제 알림에 섞인다(실측 7명 · 알림 10건).
 *
 * 🔴 **단일 지점(`notifyUsers`) 차단은 불가능하다** — 그 함수는 수신자·본문만 받고 학생 id를 모른다.
 *    게다가 알림 본문은 묶음이라(`구한결 외 10명 …`) 항목째 버리면 **실학생 10명의 알림이 함께 사라진다**.
 *    그래서 거르는 자리는 언제나 **경로별 "후보 선정 단계"**이고, 이 함수가 그 판정 재료를 한 벌로 준다.
 * 🔴 **fail-open(조회 실패 = 빈 집합)** — 판정을 못 했다고 그날 진짜 알림이 통째로 사라지는 쪽이 더 나쁘다
 *    (집계의 fail-open 규약과 같은 결: `report-subjects.ts`·`action-signals.ts` 주석).
 *    ⚠️ 단 **'아무도 안 뺀다'가 곧 '전부 알린다'인 소비처에서만** 그렇다. `complete-notify`는 이 집합이
 *       *명단을 줄여* 벨을 **켜는** 쪽이라, 빈 집합이면 그 반의 벨이 그날 안 울린다(= 이 변경 전 동작).
 *       다음 칸 저장에서 저절로 회복되므로 회귀는 아니지만, 여기 fail-open이 네 소비처에서 같은 방향으로
 *       안전한 것은 아니라는 뜻이다 — 새 소비처를 붙일 땐 어느 방향으로 기우는지 먼저 볼 것.
 * ⚠️ **admin(RLS 우회) 클라이언트로 부를 땐 `tenantId`를 반드시 넘긴다** — 유일한 격리선이다.
 *    쿠키 클라이언트(RLS 경로)면 생략한다(중복 필터 불필요).
 * ⚠️ B2 — 세는 데 쓰는 전건 조회라 `fetchAllPaged` + unique tie-break `id` 정렬(무페이징 select 금지).
 * ⚠️ 빼는 곳 = **집계·알림 + 데스크 표면**이다. 데스크 표면 = 오늘 출결(좌석표·확인 필요·어제 출결 —
 *    `loadLiveSlots`의 `excludeTestStudents`)과 처리현황(`getDailyProcessingStatus` — 운영실 'N반'·브리핑
 *    '오늘 출석 미기록'·일별 출석부 처리 현황) · 브리핑 '어제 출석 미기록'(`unrecordedClassesSignal`) · 강사 스트립
 *    '데스크 확인 요청' 벨(`requestDeskConfirm` — 테스트 학생뿐이면 벨 없이 거절). 원장 2026-09-14 *"학원이 반 및
 *    학원이 (테스트 학생)이 오늘 출결에 올라와있는데 예외로 빼."* 데스크 표면에선 빈 집합(조회 실패)이면 지금처럼
 *    보일 뿐이라 fail-open이 안전하다.
 *    선생님 **자기 화면**(원스크린·ECS·월별 출석부·강사 스트립·출결 모드)과 학생목록에는 그대로 보여야 테스트가
 *    된다 — 거기까지 빼면 배정한 의미가 없어진다.
 */
export async function getTestStudentIds(
  // 서버 클라이언트와 admin 클라이언트를 둘 다 받는다(제네릭이 달라 최소 구조로 — report-optout-ids 선례).
  supabase: Pick<SupabaseClient, "from">,
  tenantId?: string | null,
): Promise<Set<string>> {
  const rows = await fetchAllPaged<{ id: string }>((from, to) => {
    let query = supabase.from("students").select("id").eq("is_test", true);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    return query.order("id").range(from, to) as unknown as PromiseLike<{
      data: { id: string }[] | null;
      error: { message: string } | null;
    }>;
  }).catch((error: unknown) => {
    // fail-open — 못 읽었으면 아무도 빼지 않는다(위 주석). 조용히 넘기지는 않는다.
    console.error("[students/test-students] 테스트 학생 조회 실패 — 아무도 제외하지 않습니다", error);
    return [] as { id: string }[];
  });
  return new Set(rows.map((row) => row.id));
}
