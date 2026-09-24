import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth/require-access";
import { EmbedLink } from "@/components/embed-link";
import { PeriodNav } from "@/components/period-nav";
import { shiftMonth, kstMonth } from "@/lib/date-kst";
import { getMathSheetLanding, type MathClassCard } from "@/features/math-sheets/server/landing";
import { groupMathCardsByTeacher, splitLandingByTrack } from "@/features/math-sheets/landing-tracks";
import { canPreviewProgressMap } from "@/features/math-progress-map/server/access";
import styles from "./landing.module.css";

export const metadata: Metadata = { title: "수학 강사 시트 — aywa" };
const EMPTY_TEXT: Record<string, string> = {
  "no-classes": "활성 수학 반이 없습니다.",
  "no-scoped-classes": "담당하는 수학 반이 없습니다.",
  "no-month-classes": "이 달에 수업이 있는 수학 반이 없습니다.",
};

export default async function McsLandingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAccess("mcs");
  const { month } = await searchParams;
  const [res, previewProgressMap] = await Promise.all([getMathSheetLanding(month ?? null), canPreviewProgressMap()]);
  if (!res.ok) return <div className={styles.surface}><header className={styles.heading}><h2>수학 강사 시트</h2></header><p className={styles.empty}>{res.error}</p></div>;
  const { data } = res;
  const thisMonth = kstMonth();
  const hrefFor = (value: string) => `/mcs?month=${value}`;
  const panels = splitLandingByTrack(data.cards);
  const written = data.cards.reduce((sum, card) => sum + card.written, 0);
  const shown = data.cards.reduce((sum, card) => sum + card.shown, 0);
  const pct = shown ? Math.round(written / shown * 100) : null;
  return (
    <div className={styles.surface}>
      <header className={styles.heading}>
        <div><h2>수학 강사 시트</h2><p>반별 수업 기록과 학생 진도를 한곳에서 확인하세요.</p></div>
        <PeriodNav label={data.monthLabel} prevHref={hrefFor(shiftMonth(data.month, -1))} nextHref={hrefFor(shiftMonth(data.month, 1))} currentHref={hrefFor(thisMonth)} relation={data.month === thisMonth ? "current" : data.month < thisMonth ? "past" : "future"} prevAriaLabel="이전 달" nextAriaLabel="다음 달" currentTitle="눌러서 이번 달로" />
      </header>
      <div className={styles.summary}>
        <div className={styles.summaryCount}><span>이번 달 수업</span><strong>{data.cards.length}<small>개 반</small></strong></div>
        <div className={styles.summaryProgress}>
          <div><span>전체 기록 작성률</span><strong data-complete={pct === 100 || undefined}>{pct == null ? "—" : `${pct}%`}</strong></div>
          {pct != null ? <><Progress value={pct} label="전체 기록 작성률" /><small>{written.toLocaleString()} / {shown.toLocaleString()}건 작성</small></> : <small>아직 작성 대상 기록이 없습니다.</small>}
        </div>
        <div className={styles.summaryAction}>
          <p>반을 선택하면<br /> 학생별 진도와 목표가 열립니다.</p>
          {previewProgressMap ? <EmbedLink href="/mcs/progress-map">진도맵(시안) <span aria-hidden>↗</span></EmbedLink> : null}
        </div>
      </div>
      {data.emptyReason ? <p className={styles.empty}>{EMPTY_TEXT[data.emptyReason] ?? "표시할 반이 없습니다."}</p> : (
        <div className={panels ? styles.panels : styles.singlePanel}>
          {(panels ?? [{ key: data.cards[0]?.isSpecial ? "special" : "regular", label: data.cards[0]?.isSpecial ? "특강" : "정규", cards: data.cards }]).map((panel) => (
            <section key={panel.key} className={styles.panel}>
              <header className={styles.panelHeading}><h3>{panel.label}<span>{panel.cards.length}반</span></h3><WrittenSummary cards={panel.cards} /></header>
              <div className={styles.teacherGroups}>
                {groupMathCardsByTeacher(panel.cards).map((group) => (
                  <section key={group.teacherName} className={styles.teacherGroup}>
                    <header className={styles.teacherHeading}><h4>{group.teacherName}</h4><span>{group.cards.length}개 반</span></header>
                    <div className={styles.rows}>
                      {group.cards.map((card) => (
                        <EmbedLink key={card.classId} href={`/mcs/${card.classId}/month?month=${data.month}`} className={styles.row}>
                          <span className={styles.classInfo}>
                            <strong title={card.className}>{card.className}</strong>
                            <span title={card.extraTitle ?? undefined}>수업 {card.dayCount}일 <i>·</i> 학생 {card.studentCount}명{card.extraCount > 0 ? ` +${card.extraCount}` : ""}<i>·</i>{card.learningTrack === "supplement" ? "복습 심화" : "정규 진도"}</span>
                          </span>
                          <span className={styles.writing}>
                            {card.elapsedDays === 0 ? <span className={styles.noRecords}>아직 수업 전</span> : card.shown === 0 ? <span className={styles.noRecords}>출결 기록 없음</span> : (
                              <><span className={styles.writingLabel}><span>{card.written}/{card.shown} <small>작성</small></span><b data-complete={card.pct === 100 || undefined}>{card.pct}%</b></span><Progress value={card.pct} label={`${card.className} 기록 작성률`} /></>
                            )}
                          </span>
                          <span className={styles.arrow} aria-hidden>›</span>
                        </EmbedLink>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return <span className={styles.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span data-complete={value === 100 || undefined} style={{ width: `${value}%` }} /></span>;
}
function WrittenSummary({ cards }: { cards: readonly MathClassCard[] }) {
  const written = cards.reduce((sum, card) => sum + card.written, 0), shown = cards.reduce((sum, card) => sum + card.shown, 0);
  if (!shown) return null;
  return <span className={styles.panelSummary}>{written}/{shown}건 <b>{Math.round(written / shown * 100)}%</b></span>;
}
