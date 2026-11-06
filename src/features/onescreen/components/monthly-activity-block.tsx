import { LEVELS, summarizeMonthlyActivity, type MonthlyActivity } from "@/features/report-templates/monthly-activity";
import styles from "./monthly-activity-block.module.css";

/**
 * EiE 월간 보고서의 **한 달 학습 기록**(원장 2026-11-06 *"해당 달에 쌓은 데이터 가지고 그래프나 도표로 숙제완성도, 수업태도,
 * 단어테스트 통계"*) — 요약 칸 넷 → 수업별 막대(숙제 완성도·단어 테스트 정답률, 같은 0~100% 축) → 태도 분포 → 수업별 표.
 * 서버(/r·인쇄)와 원스크린 미리보기가 같이 그리는 순수 프레젠테이션(훅 없음). 재료는 글에 동결된 한 줄(monthly-activity.ts).
 * 값이 없는 수업은 그 막대·칸을 비운다(지어내지 않는다).
 */

const LEVEL_LABEL: Record<(typeof LEVELS)[number], string> = {
  상: "Excellent",
  중상: "Good",
  중: "Fair",
  중하: "Needs effort",
  하: "Poor",
};

const dayLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const pctOf = (w: { right: number; total: number } | null) => (w ? Math.round((w.right / w.total) * 100) : null);

export function MonthlyActivityBlock({ activity }: { activity: MonthlyActivity }) {
  const sum = summarizeMonthlyActivity(activity);
  const topLevel = [...LEVELS].reverse().reduce<(typeof LEVELS)[number] | null>(
    (best, lv) => (sum.attitudeCounts[lv] > (best ? sum.attitudeCounts[best] : 0) ? lv : best),
    null,
  );
  const maxCount = Math.max(1, ...LEVELS.map((lv) => sum.attitudeCounts[lv]));
  return (
    <section className={styles.block} aria-label="Monthly Class Record">
      <h2 className={styles.title}>Monthly Class Record</h2>
      <div className={styles.tiles}>
        <Tile label="수업" value={`${sum.lessons}회`} />
        <Tile label="숙제 완성도" value={sum.homeworkAvg == null ? "-" : `${sum.homeworkAvg}%`} />
        <Tile label="수업 태도" value={topLevel ?? "-"} />
        <Tile
          label="단어 테스트"
          value={sum.wordAvg == null ? "-" : `${sum.wordAvg}%`}
          note={sum.retestCount ? `재시험 ${sum.retestCount}회` : undefined}
        />
      </div>

      <figure className={styles.chart}>
        <figcaption className={styles.chartTitle}>숙제 완성도 · 단어 테스트 정답률</figcaption>
        <div className={styles.legend}>
          <span>
            <i className={`${styles.swatch} ${styles.hw}`} /> 숙제 완성도
          </span>
          <span>
            <i className={`${styles.swatch} ${styles.word}`} /> 단어 테스트
          </span>
        </div>
        <div className={styles.columns}>
          {activity.lessons.map((l, i) => {
            const word = pctOf(l.word);
            return (
              <div key={`${l.date}-${i}`} className={styles.col}>
                <div className={styles.pair}>
                  <div
                    className={`${styles.vbar} ${styles.hw}`}
                    style={{ height: `${l.homework ?? 0}%` }}
                  />
                  <div
                    className={`${styles.vbar} ${styles.word}`}
                    style={{ height: `${word ?? 0}%` }}
                  />
                </div>
                <span className={styles.day}>{dayLabel(l.date)}</span>
                {l.retest ? <span className={styles.retest}>재</span> : <span className={styles.retestGap} />}
              </div>
            );
          })}
        </div>
      </figure>

      <div className={styles.attitude}>
        <p className={styles.subTitle}>수업 태도 (총 {sum.attitudeCount}회)</p>
        {[...LEVELS].reverse().map((lv) => (
          <div key={lv} className={styles.attRow}>
            <span className={styles.attLabel}>
              {lv} <small>{LEVEL_LABEL[lv]}</small>
            </span>
            <span className={styles.attTrack}>
              <span className={styles.attBar} style={{ width: `${(sum.attitudeCounts[lv] / maxCount) * 100}%` }} />
            </span>
            <span className={styles.attCount}>{sum.attitudeCounts[lv]}회</span>
          </div>
        ))}
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>날짜</th>
            <th>숙제 완성도</th>
            <th>수업 태도</th>
            <th>단어 테스트</th>
          </tr>
        </thead>
        <tbody>
          {activity.lessons.map((l, i) => (
            <tr key={`${l.date}-${i}`}>
              <td>{dayLabel(l.date)}</td>
              <td>{l.homework == null ? "-" : `${l.homework}%`}</td>
              <td>{l.attitude ?? "-"}</td>
              <td>
                {l.word ? `${l.word.right}/${l.word.total}` : "-"}
                {l.retest ? <span className={styles.retestTag}>재시험</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {note ? <span className={styles.tileNote}>{note}</span> : null}
    </div>
  );
}
