import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getFirstClassStudents } from "@/features/dashboard/server/day-arrivals-query";
import type { Program } from "../program";
import { getProgramStudentIds } from "./enrolled-programs";

/**
 * 운영실 KPI ↗가 넘긴 학생 집합(원장 2026-09-11) — 카드·팝업과 **같은 함수**로 만든다(그래야 같은 수가 나온다).
 * 원생목록 화면과 엑셀 내보내기가 **같이** 쓴다(파일 행 = 목록 행).
 * `program=` = 재원생 팝업의 프로그램(programOf) · `first=` = 그날 첫 수업(첫 등원 + 새 과목). 둘 다 있으면 교집합.
 * ⚠️ 날짜 검증(`isValidYmd`)은 호출부가 한다 — 여기로는 달력에 있는 날짜만 온다.
 */
export async function restrictIdsFor(
  program: Program | null,
  first: string | null,
): Promise<ReadonlySet<string> | null> {
  if (!program && !first) return null;
  const [byProgram, byFirst] = await Promise.all([
    program ? getProgramStudentIds(program) : Promise.resolve(null),
    first
      ? getTenantSettings()
          .then((settings) => getFirstClassStudents(first, settings.operations.subjects))
          .then((list) => new Set(list.map((s) => s.studentId)))
      : Promise.resolve(null),
  ]);
  if (byProgram && byFirst) return new Set([...byProgram].filter((id) => byFirst.has(id)));
  return byProgram ?? byFirst;
}
