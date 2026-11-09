import { OPERATION_METRICS, PARTICIPATION_METRICS, type ContributionConfig, type Metric, type Raws } from "../model/config";
import { familyRates, type FamilyLoyalty } from "../model/family-loyalty";
import { formulaText, metricLabels, numberText, rateUnit } from "./presentation";
import styles from "./total-breakdown.module.css";

type Row = { key: string; label: string; detail: string; points: number };

/**
 * 시안: 총점 구성 — 로열티 점수가 어떤 항목에서 몇 점씩 왔는지 한 장에(원장 2026-11-09 *"총점수에 대한 세부 점수를 디테일하게"*).
 * 값은 위 '로열티 점수'와 같은 계산(누적 실적 × 현재 배점 + 가족 가점)을 펼친 것뿐이라 합계가 늘 같다.
 */
export function TotalBreakdown({ raws, points, config, family, familyBonus, total }: {
  raws: Raws; points: Record<Metric, number>; config: ContributionConfig;
  family: FamilyLoyalty; familyBonus: number | null; total: number | null;
}) {
  const row = (id: Metric): Row => ({ key: id, label: metricLabels[id],
    detail: config.rates[id].enabled ? `${formulaText(id, raws[id], config.rates[id].points)} · ${rateUnit(id)}` : "배점 꺼짐", points: points[id] });
  const group = (ids: readonly Metric[]) => ids.map(row).filter((r) => r.points !== 0 || raws[r.key as Metric] !== 0);
  const operations = group(OPERATION_METRICS), participation = group(PARTICIPATION_METRICS);
  const rates = familyRates(config);
  const count = family.activeCount ?? 0;
  const base = count >= 4 ? rates.fourPlus : count === 3 ? rates.three : count === 2 ? rates.two : 0;
  const together = familyBonus && base ? familyBonus - base : 0;
  const familyRows: Row[] = familyBonus === null ? [] : [
    { key: "family-count", label: "형제 수 기본 가점", detail: count >= 2 ? `지금 함께 재원 ${count}명(본인 포함)` : "함께 재원 중인 형제 없음", points: base },
    ...(base ? [{ key: "family-together", label: "형제와 함께 다닌 기간", detail: `함께 다닌 기간 합 ${numberText(family.siblingMonths ?? 0)}개월 × ${rates.perTogetherMonth ?? 2}점 · 형제마다 늦은 등록일부터`, points: together }] : []),
  ];
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.points, 0);
  const sections = [
    { key: "operations", title: "운영 기여", rows: operations },
    { key: "participation", title: "학습·참여", rows: participation },
    { key: "family", title: "가족 가점", rows: familyRows },
  ].filter((s) => s.rows.length);
  const max = Math.max(1, ...sections.flatMap((s) => s.rows.map((r) => Math.abs(r.points))));
  return (
    <section className={styles.card} aria-label="총점 구성">
      <header className={styles.head}>
        <h3>총점 구성</h3>
        <p>로열티 점수 <b>{total === null ? "—" : numberText(total)}점</b> = {sections.map((s) => `${s.title} ${numberText(sum(s.rows))}`).join(" + ")}</p>
      </header>
      <div className={styles.stack} role="img" aria-label={sections.map((s) => `${s.title} ${numberText(sum(s.rows))}점`).join(", ")}>
        {sections.map((s) => <span key={s.key} className={styles[s.key]} style={{ flexGrow: Math.max(0, sum(s.rows)) }} />)}
      </div>
      <div className={styles.sections}>
        {sections.map((s) => (
          <div key={s.key} className={styles.section}>
            <h4><i className={styles[s.key]} aria-hidden />{s.title}<b>{numberText(sum(s.rows))}점</b></h4>
            <ul>
              {s.rows.map((r) => (
                <li key={r.key}>
                  <span className={styles.label}>{r.label}</span>
                  <span className={styles.detail}>{r.detail}</span>
                  <span className={styles.bar} aria-hidden><i className={styles[s.key]} style={{ width: `${Math.abs(r.points) / max * 100}%` }} /></span>
                  <b className={styles.points}>{numberText(r.points)}점</b>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
