import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SPECIAL_SLOT_ALIAS_KEYS } from "@/features/timetable/lib/teacher-label";

/**
 * s2_0017(시간표 배치 강의실 문)의 자리 별칭 목록 = 앱 `specialSlotLabel` 표. 어긋나면 앱이 자리로 보고 강의실 연결 없이 넘긴
 * 칸(영어 시트 반영 계획 `plan.ts` — `!specialSlotLabel(s.room)`)을 DB 문이 '등록되지 않은 강의실'로 거절해 반영 전체가 실패한다.
 */
it("강의실 문 SQL의 자리 별칭 = 앱 자리 별칭 표", () => {
  const sql = readFileSync("supabase/migrations/s2_0017_class_schedules_room_canonical.sql", "utf8");
  const m = /lower\(v_label\) in \(([^)]*)\)/.exec(sql);
  expect(m, "자리 별칭 목록을 찾지 못함").not.toBeNull();
  const inSql = [...m![1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]).sort();
  expect(inSql).toEqual([...SPECIAL_SLOT_ALIAS_KEYS].sort());
});
