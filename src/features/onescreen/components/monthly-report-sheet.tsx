import { MONTHLY_AREA_LABEL, MONTHLY_AREA_ORDER, type MonthlyEval } from "@/features/report-templates/monthly-eval";
import styles from "./monthly-report-sheet.module.css";

/**
 * EiE **월간 보고서** 학부모 카드 — 시트(Yoojin T_EiE Monthly Evaluation Report)를 그대로 옮긴 모양(원장 2026-11-05).
 * 위 = EiE 마크 + 'Monthly Evaluation Report' + Date·Name·Class·Teacher 표, 가운데 = 'Monthly Test Result' 막대 그래프
 * (Average 파랑 · Student's score 빨강), 아래 = 영역 점수 표 → Teacher's Comment. 좌우 빨간 띠도 시트 그대로.
 * 서버(/r·인쇄)와 원스크린 미리보기가 같이 그리는 순수 프레젠테이션(훅 없음). 재료는 글에 동결된 점수 줄(monthly-eval.ts).
 * 🔴 시트의 'Averge'는 오타라 'Average'로 적는다.
 */

export const EIE_LOGO_SRC = "/eie-logo.png";

export function MonthlyReportSheet({
  evaluation,
  date,
  studentName,
  className,
  teacherName,
  comment,
  footer,
}: {
  evaluation: MonthlyEval;
  date: string | null;
  studentName: string;
  className: string | null;
  teacherName: string | null;
  comment: string;
  footer: string | null;
}) {
  return (
    <article className={styles.sheet}>
      <header className={styles.head}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 고정 마크(최적화 불필요) */}
        <img src={EIE_LOGO_SRC} alt="EiE" className={styles.logo} />
        <div className={styles.headMain}>
          <h1 className={styles.title}>Monthly Evaluation Report</h1>
          <table className={styles.info}>
            <tbody>
              <tr>
                <td>Date :</td>
                <td>{date || "-"}</td>
                <td>Name :</td>
                <td>{studentName || "-"}</td>
              </tr>
              <tr>
                <td>Class :</td>
                <td>{className || "-"}</td>
                <td>Teacher :</td>
                <td>{teacherName || "-"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>
      <MonthlyEvalBlock evaluation={evaluation} />
      {comment ? (
        <section>
          <h2 className={styles.commentTitle}>Teacher&rsquo;s Comment:</h2>
          <p className={styles.comment}>{comment}</p>
        </section>
      ) : null}
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </article>
  );
}

const pct = (v: number | null, max: number) => (v == null ? 0 : Math.max(0, Math.min(100, (v / max) * 100)));
const fmt = (v: number | null) => (v == null ? "-" : String(v));

/** 그래프 + 점수 표 — 월간 카드와, 다른 템플릿 글 속 `[월간평가 …]` 자리(TemplateBody)가 같이 쓴다. */
export function MonthlyEvalBlock({ evaluation: ev }: { evaluation: MonthlyEval }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(ev.areaMax * f * 10) / 10);
  return (
    <div className={styles.block}>
      <figure className={styles.chart} aria-label="Monthly Test Result">
        <figcaption className={styles.chartTitle}>Monthly Test Result</figcaption>
        <div className={styles.legend}>
          <span>
            <i className={`${styles.swatch} ${styles.avg}`} /> Average
          </span>
          <span>
            <i className={`${styles.swatch} ${styles.mine}`} /> Student&rsquo;s score
          </span>
        </div>
        <div className={styles.plot}>
          {MONTHLY_AREA_ORDER.map((k) => (
            <div key={k} style={{ display: "contents" }}>
              <span className={styles.rowLabel}>{MONTHLY_AREA_LABEL[k]}</span>
              <div className={styles.bars}>
                <div className={`${styles.bar} ${styles.avg}`} style={{ width: `${pct(ev.areas[k].average, ev.areaMax)}%` }} />
                <div className={`${styles.bar} ${styles.mine}`} style={{ width: `${pct(ev.areas[k].score, ev.areaMax)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className={styles.axis}>
          {ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </figure>
      <table className={styles.scores}>
        <thead>
          <tr>
            <th />
            {MONTHLY_AREA_ORDER.map((k) => (
              <th key={k}>{MONTHLY_AREA_LABEL[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Average</th>
            {MONTHLY_AREA_ORDER.map((k) => (
              <td key={k}>{fmt(ev.areas[k].average)}</td>
            ))}
          </tr>
          <tr>
            <th>Student&rsquo;s score</th>
            {MONTHLY_AREA_ORDER.map((k) => (
              <td key={k}>{fmt(ev.areas[k].score)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
