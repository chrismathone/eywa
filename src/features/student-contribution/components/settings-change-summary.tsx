import { familyRates } from "../model/family-loyalty";
import { METRICS, type ContributionConfig } from "../model/config";
import { rankingConfig, RANKING_KEYS, RANKING_LABELS } from "../model/ranking-config";
import { metricLabels, numberText } from "./presentation";

export function SettingsChangeSummary({ before, after, delta }: { before: ContributionConfig; after: ContributionConfig; delta: number }) {
  const changes = METRICS.flatMap((id) => {
    const old = before.rates[id], next = after.rates[id];
    if (old.points === next.points && old.enabled === next.enabled) return [];
    const label = (rate: typeof old) => `${numberText(rate.points)}점${rate.enabled ? "" : " (평가 제외)"}`;
    return [`${metricLabels[id]}: ${label(old)} → ${label(next)}`];
  });
  const oldFamily = familyRates(before), newFamily = familyRates(after);
  const oldRanking = rankingConfig(before), nextRanking = rankingConfig(after);
  for (const key of RANKING_KEYS) if (oldRanking.weights[key] !== nextRanking.weights[key]) changes.push(`랭킹 ${RANKING_LABELS[key]}: ${oldRanking.weights[key]} → ${nextRanking.weights[key]}점`);
  if (oldRanking.concurrentBonus !== nextRanking.concurrentBonus) changes.push(`랭킹 동시수강 가산: ${oldRanking.concurrentBonus*100}% → ${nextRanking.concurrentBonus*100}%`);
  if (oldRanking.extraSubjectBonus !== nextRanking.extraSubjectBonus) changes.push(`랭킹 추가 과목 가산: ${oldRanking.extraSubjectBonus*100}% → ${nextRanking.extraSubjectBonus*100}%`);
  const modes = { improvement: "향상도", current: "현재 성적", both: "현재 성적 50% + 향상도 50%" };
  if (oldRanking.gradeMode !== nextRanking.gradeMode) changes.push(`랭킹 성적: ${modes[oldRanking.gradeMode]} → ${modes[nextRanking.gradeMode]}`);
  if (JSON.stringify(oldFamily) !== JSON.stringify(newFamily)) changes.push(`가족 가점: ${oldFamily.two}·${oldFamily.three}·${oldFamily.fourPlus}점 → ${newFamily.two}·${newFamily.three}·${newFamily.fourPlus}점 (${newFamily.enabled ? "반영" : "제외"})`);
  const rules = [before.referrals.months !== after.referrals.months ? `소개 재인정 간격: ${before.referrals.months} → ${after.referrals.months}개월` : null,
    before.referrals.key !== after.referrals.key ? `소개 중복 기준: ${after.referrals.key === "student" ? "같은 학생" : "같은 학생 + 같은 과목"}` : null,
    before.attendance.allowLate !== after.attendance.allowLate ? `지각 개근 인정: ${after.attendance.allowLate ? "인정" : "제외"}` : null].filter(Boolean);
  if (!changes.length && !rules.length) return null;
  return <section aria-label="저장할 변경 사항" className="w-full space-y-2 border-b border-line pb-3 text-sm">
    <h3 className="font-semibold">변경 사항 {changes.length + rules.length}개</h3>
    <ul className="space-y-1 text-xs">{[...changes, ...rules].map((change) => <li key={change}>{change}</li>)}</ul>
    <p>기존 활동 누적 점수 변화 <strong className="tabular-nums text-primary">{delta > 0 ? "+" : ""}{numberText(delta)}점</strong></p>
    {JSON.stringify(oldRanking) !== JSON.stringify(nextRanking) && <p className="text-xs">로열티 랭킹의 100점 환산·순위는 저장 후 새 기준으로 계산됩니다. 위 기존 활동 누적 변화에는 포함되지 않습니다.</p>}
    {rules.length > 0 && <p className="text-xs">인정 기준 변경의 영향은 다음 집계 후 반영되며 위 점수 변화에는 포함되지 않습니다.</p>}
  </section>;
}
