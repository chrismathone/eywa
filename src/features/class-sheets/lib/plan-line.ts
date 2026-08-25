/**
 * 계획 행 DB 로우 → DTO 변환 **단일 소스**. 순수(IO 없음)라 서버 액션·다른 조회가 함께 쓴다.
 *
 * 🔴 매핑을 두 벌로 만들지 말 것 — `slot_start`를 "HH:MM"으로 자르는 규칙(저장키 표기)이 한쪽만
 *    빠지면 그 화면의 슬롯 키가 어긋나 계획이 통째로 안 보인다.
 * ⚠️ 타입은 서버 액션이 소유한다(호출부 import 경로 불변) — 여기선 **type-only**로 받는다(런타임 의존 0).
 */
import type { PlanLineDTO } from "../server/actions";

export function planLineFromRow(row: Record<string, unknown>): PlanLineDTO {
  return {
    id: row.id as string,
    planDate: row.plan_date as string,
    slotStart: (row.slot_start as string).slice(0, 5),
    termMode: row.term_mode as "regular" | "exam",
    skillArea: row.skill_area as string,
    lineNo: Number(row.line_no),
    textbook: (row.textbook as string | null) ?? null,
    pageRange: (row.page_range as string | null) ?? null,
    progress: (row.progress as string | null) ?? null,
    homework: (row.homework as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}
