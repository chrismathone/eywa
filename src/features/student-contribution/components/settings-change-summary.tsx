import { familyRates } from "../model/family-loyalty";
import { METRICS, type ContributionConfig } from "../model/config";
import { metricLabels, numberText } from "./presentation";

export function SettingsChangeSummary({ before, after, delta }: { before: ContributionConfig; after: ContributionConfig; delta: number }) {
  const changes = METRICS.flatMap((id) => {
    const old = before.rates[id], next = after.rates[id];
    if (old.points === next.points && old.enabled === next.enabled) return [];
    const label = (rate: typeof old) => `${numberText(rate.points)}점${rate.enabled ? "" : " (평가 제외)"}`;
    return [`${metricLabels[id]}: ${label(old)} → ${label(next)}`];
  });
  const oldFamily = familyRates(before), newFamily = familyRates(after);
  if (JSON.stringify(oldFamily) !== JSON.stringify(newFamily)) changes.push(`가족 가점: ${oldFamily.two}·${oldFamily.three}·${oldFamily.fourPlus}점 → ${newFamily.two}·${newFamily.three}·${newFamily.fourPlus}점 (${newFamily.enabled ? "반영" : "제외"})`);
  const rules = [before.referrals.months !== after.referrals.months ? `소개 재인정 간격: ${before.referrals.months} → ${after.referrals.months}개월` : null,
    before.referrals.key !== after.referrals.key ? `소개 중복 기준: ${after.referrals.key === "student" ? "같은 학생" : "같은 학생 + 같은 과목"}` : null,
    before.attendance.allowLate !== after.attendance.allowLate ? `지각 개근 인정: ${after.attendance.allowLate ? "인정" : "제외"}` : null].filter(Boolean);
  if (!changes.length && !rules.length) return null;
  return <section aria-label="저장할 변경 사항" className="w-full space-y-2 border-b border-line pb-3 text-sm">
    <h3 className="font-semibold">변경 사항 {changes.length + rules.length}개</h3>
    <ul className="space-y-1 text-xs">{[...changes, ...rules].map((change) => <li key={change}>{change}</li>)}</ul>
    <p>배점 변경 후 전체 누적 점수 <strong className="tabular-nums text-primary">{delta > 0 ? "+" : ""}{numberText(delta)}점</strong></p>
    {rules.length > 0 && <p className="text-xs">인정 기준 변경의 영향은 다음 집계 후 반영되며 위 점수 변화에는 포함되지 않습니다.</p>}
  </section>;
}
