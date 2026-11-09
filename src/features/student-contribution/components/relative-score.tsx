"use client";
import { useState } from "react";
import { CONTRIBUTION_TIERS, type RelativeMetric, type RelativeResult, type RelativeScope, type TierName } from "../model/relative-score";
import { numberText } from "./presentation";
import styles from "./relative-score.module.css";

const tierClasses: Record<TierName, string> = { "5등급": styles.iron, "4등급": styles.bronze, "3등급": styles.silver, "2등급": styles.gold, "1등급": styles.platinum };
// Round upward so a value just outside a grade boundary is not displayed inside it.
const topText = (value: number | null) => value === null ? "상위 비율 —" : `상위 ${numberText(Math.ceil(value * 10 - 1e-9) / 10)}%`;
export function RelativeScoreBadge({ result }: { result: RelativeResult }) {
  return <span className={styles.badgeWrap}>
    <span className={`${styles.badge} ${result.tier ? tierClasses[result.tier] : styles.iron}`}>{result.tier ?? "등급 보류"}{result.tier && result.partial > 0 ? " · 잠정" : ""}</span>
    {result.topPercent !== null && <span className={styles.rankSmall}>{topText(result.topPercent)}</span>}
    <span className={styles.rankSmall}>{result.rank !== null ? `${result.ties > 1 ? "공동 " : ""}${result.rank}위 / ${result.count}명` : "재원생 비교 대상 아님"}</span>
  </span>;
}
export function RelativeScore({ options, refreshedAt, periodLabel, error }: {
  options: RelativeResult[]; refreshedAt: string | null; periodLabel: string; error?: string;
}) {
  const [scope, setScope] = useState<RelativeScope>("all"), [metric, setMetric] = useState<RelativeMetric>("total");
  const result = options.find(r => r.scope === scope && r.metric === metric);
  return <section className={styles.panel} aria-label="로열티 상대 위치">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>RELATIVE LOYALTY</p><h2>이 점수, 어느 정도인가요?</h2><p>같은 기준으로 계산한 재원생 안에서의 상대 위치입니다.</p></div>
      <div className={styles.controls}>
        <label>점수 기준<select aria-label="상대평가 점수 기준" value={metric} onChange={e => setMetric(e.target.value as RelativeMetric)}><option value="total">로열티 점수</option><option value="recent">최근 12개월 활동 (가족 가점 제외)</option></select></label>
        <label>비교 대상<select aria-label="상대평가 비교 대상" value={scope} onChange={e => setScope(e.target.value as RelativeScope)}><option value="all">전체 재원생</option><option value="grade">같은 학년</option><option value="tenure">비슷한 재원기간</option></select></label>
      </div>
    </header>
    {error || !result ? <p role="status" className={styles.notice}>{error ?? "비교 자료가 아직 없습니다."}</p> : <>
      <div className={styles.context}>{result.label} · 집계 {result.count}명 / 대상 {result.eligible}명 · {metric === "total" ? "활동 누적 + 현재 가족 가점" : periodLabel}
        {refreshedAt && <span>마지막 집계 {new Date(refreshedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })}</span>}
      </div>
      <div className={styles.body}>
        <div className={`${styles.level} ${result.tier ? tierClasses[result.tier] : styles.iron}`}>
          <p>{result.partial > 0 ? "확인된 실적 기준 · 잠정 등급" : "로열티 등급"}</p>
          <strong>{result.tier ?? "등급 보류"}</strong>
          <span>{topText(result.topPercent)}</span>
          <div className={styles.score}>{result.score === null ? "—" : numberText(result.score)}<small> 점</small></div>
          <span>{result.rank === null ? "순위 확인 필요" : `${result.ties > 1 ? "공동 " : ""}${result.rank}위 / ${result.count}명`}</span>
        </div>
        <div className={styles.distribution}>
          <div className={styles.positionHeading}><h3>실제 최저점에서 최고점 사이</h3><span>1등급이 가장 높습니다</span></div>
          {result.position !== null && <div className={styles.track} role="img" aria-label={`최저 ${numberText(result.min!)}점, 이 학생 ${numberText(result.score!)}점, 최고 ${numberText(result.max!)}점`}>
            <div className={styles.fill} style={{ width: `${result.position}%` }} />
            <span className={styles.marker} style={{ left: `${Math.max(2, Math.min(98, result.position))}%` }}><b>{numberText(result.score!)}점</b><i /></span>
          </div>}
          <dl className={styles.stats}>{[["실제 최저", result.min], ["중앙값", result.median], ["실제 최고", result.max]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{typeof value === "number" ? `${numberText(value)}점` : "—"}</dd></div>)}</dl>
          <div className={styles.tiers} aria-label="상위 비율별 5등급">{CONTRIBUTION_TIERS.map(t => <div key={t.name} className={`${tierClasses[t.name]} ${result.tier === t.name ? styles.selected : ""}`} aria-current={result.tier === t.name ? "step" : undefined}><strong>{t.name}</strong><small>{t.range}</small></div>)}</div>
          <p className={styles.explanation}>상위 비율이 작을수록 높은 순위입니다. 1등급은 상위 20% 이내이며, 위 막대는 실제 점수 간격을 보여줍니다.</p>
        </div>
      </div>
      {result.reason && <p role="status" className={styles.notice}>{result.reason}</p>}
      {(result.partial > 0 || result.missing > 0) && <p className={styles.notice}>미확인 항목이 있는 {result.partial}명은 확인된 실적만으로 잠정 비교합니다. 미집계 {result.missing}명은 0점으로 넣지 않고 비교에서 제외합니다.</p>}
      <details className={styles.method}><summary>등급 기준과 비교 시 유의점</summary><p>상위 비율은 순위 ÷ 집계 인원 × 100으로 계산합니다. 소수 둘째 자리까지 같은 점수는 공동 순위·동일 등급이며, 비율 계산에는 동점 구간의 평균 순위를 사용합니다. 예를 들어 공동 1위가 2명이면 비율은 1.5위로 계산합니다. 표시 비율은 소수 첫째 자리까지 올림하며 등급은 올림 전 값으로 정합니다. 비교 인원이 5명 미만이거나 전원 동점이면 등급을 보류합니다.</p><p>로열티 점수에는 현재 가족 가점이 포함됩니다. 활동 누적은 오래 다닌 학생에게 유리합니다. 가족 가점을 제외한 최근 활동은 ‘최근 12개월’, 비슷한 수강 기간끼리는 ‘비슷한 재원기간’으로 확인하세요. 재원기간은 유효한 수업료 청구가 있는 달 수이며, 최근 12개월에도 이번 달 집계분과 정정이 포함됩니다.</p><p>현재 배점에 따른 운영·학습 참여 지표이며, 학업 성취도나 학생의 가치를 평가하는 등급은 아닙니다. 실제 최고점은 비교 집단의 관측값이며 고정 만점은 아닙니다.</p></details>
    </>}
  </section>;
}
