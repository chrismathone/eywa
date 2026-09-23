import "server-only";

/**
 * 성적관리의 **강사 스코프** = 담임 ∪ 부담임(교시 담당).
 *
 * 🔴 원장 2026-09-23: *"성적관리는 자기가 담임, 부담임반으로 되어있으면 나오고 부원장 관리자 직급은
 *    모든반 볼 수있도록 수정해서 메뉴 오픈하자"*.
 *    그전엔 강사 스코프가 **과목 기준**이라(영어 강사 = 영어 전 반) 자기 반은 위로 정렬만 됐다.
 *    이제 **반 단위로 좁힌다** — 담당이 아닌 반은 목록에서 아예 빠진다.
 *
 * 🔑 **왜 `getTeacherScope`를 안 쓰나**: 그건 `classes.teacher_id`(담임)만 본다. 부담임은 시간표 슬롯
 *    (`class_schedules.teacher_id`)에 있어서 한 갈래를 더 봐야 한다. 그렇다고 공용 스코프를 넓히면
 *    그걸 쓰는 **다른 화면들의 범위가 조용히 함께 넓어진다** — 그래서 성적관리 전용으로 둔다.
 * 🔑 영어 전용인 [`englishAssistantClassIdsOf`](@/features/class-sheets/server/access)와도 다르다 —
 *    성적은 과목을 안 가리므로 여기선 과목 조건을 걸지 않는다(수학 슬롯 담당은 실데이터가 0이라
 *    결과가 같지만, 배선이 생기면 자동으로 따라온다).
 *
 * ⚠️ **조회 실패는 빈 배열이 아니라 그대로 좁힌다** — 부담임 조회가 실패해도 담임 반은 살아 있어야
 *    하고(fail-closed로 전건이 사라지면 강사가 자기 반도 못 본다), 반대로 실패를 "전체 허용"으로
 *    읽으면 안 된다([[#60]]과 달리 여기는 **데이터 범위**라 넓히는 쪽이 위험하다).
 * ⚠️ 유효기간이 지난 슬롯도 센다 — 지난 학기 성적을 보려면 그때 담당이던 반이 필요하다
 *    (주 단위로 좁히는 ECS 목록과 반대 방향이다).
 */
import { createClient } from "@/lib/supabase/server";

export async function gradeTeacherClassIds(teacherId: string): Promise<string[]> {
  const supabase = await createClient();
  const [own, slots] = await Promise.all([
    supabase.from("classes").select("id").eq("teacher_id", teacherId),
    supabase.from("class_schedules").select("class_id").eq("teacher_id", teacherId),
  ]);

  const ids = new Set<string>();
  for (const r of own.data ?? []) ids.add(String(r.id));
  for (const r of slots.data ?? []) ids.add(String(r.class_id));
  return [...ids];
}
