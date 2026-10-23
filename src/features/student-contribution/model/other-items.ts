/** 원장 확인(2026-10-23): 과목이 없는 기타 비용. 운영 원본은 보존하고 기여도 수업 실적에서만 구분한다. */
export function isOtherContributionItem(name: string) {
  const text = name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const studyCare = ["스터디케어", "[인재원300]1a스터디케어", "[방학특강]스터디케어"].includes(text);
  return /(?<!\d)100점프로젝트/.test(text) || text === "스쿨버스비" || studyCare;
}
