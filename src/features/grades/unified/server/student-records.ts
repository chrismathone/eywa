import "server-only";

import { cache } from "react";
import { withPreviousScores, type UnifiedRow } from "../model";
import { getUnifiedGrades } from "./queries";

/**
 * 학생 한 명의 **전체** 성적 기록(최신순) — 통합 성적관리와 같은 조회·같은 증감 계산(`withPreviousScores`).
 * 학생 상세의 성적 탭과 개요 '최근 성적'이 이것 하나를 읽는다(원장 2026-09-24 — 예전엔 성적 입력 표만 읽어
 * 수업보고서의 일일·확인테스트가 학생 상세에서 빠졌다). 요청 안에서는 한 번만 읽는다(React cache).
 */
export const getStudentUnifiedRows = cache(async (studentId: string): Promise<UnifiedRow[]> => {
  const data = await getUnifiedGrades("2000-01-01", "2100-12-31", { studentId });
  return withPreviousScores(data.records.filter((row) => row.studentId === studentId));
});
