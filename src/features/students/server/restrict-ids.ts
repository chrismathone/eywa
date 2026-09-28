import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getFirstClassStudents } from "@/features/dashboard/server/day-arrivals-query";
import type { Program } from "../program";
import type { StudentLevel, StudentMixFilter } from "../list-filter-values";
import { getCompositionStudentIds, getProgramStudentIds } from "./enrolled-programs";

/**
 * 운영실이 넘긴 학생 집합(원장 2026-09-11 · 09-28) — 카드·팝업·막대와 **같은 함수**로 만든다(그래야 같은 수가 나온다).
 * 원생목록 화면과 엑셀 내보내기가 **같이** 쓴다(파일 행 = 목록 행).
 * `program=` = 재원생 팝업의 프로그램(programOf) · `first=` = 그날 첫 수업(첫 등원 + 새 과목) ·
 * `level=`·`mix=` = '재원생 구성' 막대 조각(학교급 × 수강 구성, compositionStudentIds). 여럿이면 교집합.
 * ⚠️ 날짜 검증(`isValidYmd`)은 호출부가 한다 — 여기로는 달력에 있는 날짜만 온다.
 */
export async function restrictIdsFor(
  program: Program | null,
  first: string | null,
  composition: { levels: readonly StudentLevel[]; mixes: readonly StudentMixFilter[] } = { levels: [], mixes: [] },
): Promise<ReadonlySet<string> | null> {
  const byComposition = composition.levels.length > 0 || composition.mixes.length > 0;
  if (!program && !first && !byComposition) return null;
  const sets: (Set<string> | null)[] = await Promise.all([
    program ? getProgramStudentIds(program) : Promise.resolve(null),
    first
      ? getTenantSettings()
          .then((settings) => getFirstClassStudents(first, settings.operations.subjects))
          .then((list) => new Set(list.map((s) => s.studentId)))
      : Promise.resolve(null),
    byComposition ? getCompositionStudentIds(composition) : Promise.resolve(null),
  ]);
  const present = sets.filter((set): set is Set<string> => set !== null);
  return present.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))));
}
