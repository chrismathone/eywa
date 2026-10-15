"use server";

import { logAction } from "@/features/audit/server/log";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = /^[A-Za-z]{1,30}$/;

/**
 * 원스크린 **일괄 입력**(맨 위 행 복사 · 직접 입력 일괄 적용)을 감사로그에 한 줄 남긴다 — 원장 2026-10-15 *"감사로그 빈틈 확인하고
 * 추가할것"*(10/15 PS3A ← MS1A: 한 번의 일괄 동작이 다른 반 16행을 채웠는데 어디에도 기록이 없었다).
 *
 * 값은 칸마다 자동저장(`saveOnescreenSession`)으로 들어간다 — 칸 저장은 건마다 남기지 않는다(감사로그가 묻힌다). 그래서
 * **일괄 동작 자체**를 남긴다: 방식 · 날짜 · 몇 행 · 어느 반 · 어떤 칸. 🔴 글 내용(진도·과제·메모)은 남기지 않는다.
 * 출결·영상 검사 일괄은 그 저장 액션이 따로 남긴다(`attendance_bulk` 등) — 여기 칸 목록에 넣지 않는다.
 * best-effort — 기록 실패는 일괄 입력을 막지 않는다(logAction과 같다).
 */
export async function logOnescreenBulkApply(input: {
  mode: "copy" | "input";
  date: string;
  rows: number;
  classIds: readonly (string | null | undefined)[];
  fields: readonly string[];
}): Promise<void> {
  const rows = Number.isFinite(input.rows) ? Math.max(0, Math.min(2000, Math.round(input.rows))) : 0;
  if (rows === 0) return;
  const classIds = [...new Set(input.classIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, 50);
  const fields = [...new Set(input.fields.filter((f) => typeof f === "string" && FIELD.test(f)))].slice(0, 20);
  await logAction({
    action: "onescreen_bulk_apply",
    targetType: "class",
    metadata: {
      mode: input.mode === "copy" ? "copy" : "input",
      date: DAY.test(input.date) ? input.date : null,
      rows,
      classIds,
      fields,
    },
  });
}
