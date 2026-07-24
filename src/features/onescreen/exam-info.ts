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

/**
 * exam_info의 **분모(척도/만점)** — 개수 모드는 문항수, 점수 모드는 100(0148a). prevScore가 척도 무관 raw라,
 * 직전 회차와 오늘의 척도가 다르면(개수 20 ↔ 점수 100) 증감을 빼면 안 된다 → roster가 이 값으로 척도 일치를 확인.
 */
export function parseExamMaxes(
  examInfo: string | null | undefined,
): { daily: number | null; check: number | null } {
  const pick = (label: string): number | null => {
    if (!examInfo) return null;
    const m = examInfo.match(new RegExp(`${label}\\s+\\d+\\s*/\\s*(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  return { daily: pick("일일"), check: pick("확인") };
}
