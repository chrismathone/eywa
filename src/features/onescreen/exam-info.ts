/**
 * onescreen exam_info 텍스트 파서.
 *
 * onescreen-client.tsx가 조립하는 형식("일일 18/20, 확인 19/20")에서 점수(맞은 개수)를
 * 역파싱한다. roster가 직전 lesson_reports의 exam_info에서 prevScore(직전 회차 점수)를
 * 얻어 DeltaChip(증감 배지)·"지난 회차 대비" 문구를 되살리는 데 쓴다. 순수 함수(Vitest).
 */
export function parseExamScores(
  examInfo: string | null | undefined,
): { daily: number | null; check: number | null } {
  const pick = (label: string): number | null => {
    if (!examInfo) return null;
    // "일일 18/20" / "확인 19/20" — 맞은 개수(분자)만.
    const m = examInfo.match(new RegExp(`${label}\\s+(\\d+)\\s*/\\s*\\d+`));
    return m ? Number(m[1]) : null;
  };
  return { daily: pick("일일"), check: pick("확인") };
}
