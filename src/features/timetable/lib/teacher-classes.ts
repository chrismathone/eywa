/**
 * 강사 스코프 시간표에 세울 반 — **담임 반 ∪ 그 주에 내가 교시 하나라도 맡은 반**.
 * 원장 2026-09-17 *"강사뷰 시간표를 볼 때 '담당'뿐만 아니라 '내가 수업하는 수업' 모두 보여줘. 하나라도 수업하면 보여줘"*.
 *
 * - 교시 담당의 근거는 `class_schedules.teacher_id`(FK)**만** — `slot_teacher_label`은 권한 근거 금지(ECS 부담임 ·
 *   원생 상세 열람 범위와 같은 규약). JJ·LAB 자리 교시는 FK가 비어 있어 저절로 빠진다.
 * - "그 주에"는 **화면에 실제로 그려지는 슬롯**으로 잰다 — `mySlotIds`(내 FK 행)를 그 주 슬롯 id와 겹쳐 본다.
 *   유효기간만 보면 끝난 배치·아직 안 시작한 배치의 반이 섞인다(시간표가 요일 칸 날짜로 거른 것과 같은 판정).
 * - 🔴 전역 `getTeacherScope`(담임 반)는 넓히지 않는다 — 출석·원생·교재요청 쓰기까지 함께 넓어진다(가드 `ecs-scope-sources.test.ts`).
 */
export function teachingClassIdsInWeek(
  slots: readonly { id: string; classId: string }[],
  homeroomClassIds: readonly string[],
  mySlotIds: Iterable<string>,
): Set<string> {
  const mine = new Set(mySlotIds);
  const out = new Set(homeroomClassIds);
  for (const s of slots) if (mine.has(s.id)) out.add(s.classId);
  return out;
}
