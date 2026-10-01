/**
 * 원생상담 통계 **지표 줄** — 목록 위 요약 띠와 통계 화면의 지표 카드가 **같은 함수**로 만든다(순수 · 서버/클라 공용, [[#61]]).
 * 두 표면이 숫자를 따로 계산하면 같은 필터에서 값이 갈린다(원장 2026-10-01 — 요약 띠 ↔ 통계 화면 불일치 방지).
 * 0318a 전(헤드 카운트뿐, `full: false`)엔 원생 수·반 칸이 없어 '1인당 상담'·'반 미매핑' 줄이 빠진다 — 있는 지표만.
 */
import { pct, type ConsultationStats, type StatsMetric } from "./stats-model";

export const fmt = (n: number) => n.toLocaleString("ko-KR");
export const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

export type KpiLine = { metric: StatsMetric; label: string; value: string; sub?: string; link?: { href: string; text: string } };

export function buildKpiLines(
  stats: ConsultationStats,
  /** `overdueHref`·`doneHref` = 지표 옆 링크(목록을 그 값으로 연다) — 요약 띠처럼 링크를 안 다는 표면은 비운다. */
  opts: { syncOn: boolean; classOn: boolean; overdueHref?: string; doneHref?: string },
): KpiLine[] {
  const t = stats.totals;
  const full = stats.full ? stats.totals : null;
  const followTotal = t.done + t.pending;
  const lines: KpiLine[] = [{ metric: "count", label: "상담", value: `${fmt(t.n)}건`, sub: full ? `원생 ${fmt(full.students)}명` : undefined }];
  if (full) {
    lines.push({
      metric: "perStudent",
      label: "1인당 상담",
      value: full.students > 0 ? `${(Math.round((t.n / full.students) * 10) / 10).toLocaleString("ko-KR")}건` : "—",
      sub: "상담 수 ÷ 상담받은 원생 수",
    });
  }
  lines.push(
    {
      metric: "follow",
      label: "후속 완료율",
      value: pctText(pct(t.done, followTotal)),
      sub: `완료 ${fmt(t.done)} / 기한 있는 후속 ${fmt(followTotal)}`,
      link:
        t.overdue > 0 && opts.overdueHref
          ? { href: opts.overdueHref, text: `지연 ${fmt(t.overdue)}건` }
          : t.overdue === 0 && t.done > 0 && opts.doneHref
            ? { href: opts.doneHref, text: "완료 보기" }
            : undefined,
    },
    {
      metric: "media",
      label: "녹음 · AI 분석",
      value: `${pctText(pct(t.audio, t.n))} · ${pctText(pct(t.ai, t.n))}`,
      sub: `녹음 ${fmt(t.audio)}건 · AI ${fmt(t.ai)}건`,
    },
  );
  if (opts.syncOn) {
    lines.push({ metric: "sync", label: "동기화 비율", value: pctText(pct(t.synced, t.n)), sub: `동기화 ${fmt(t.synced)} · 앱 작성 ${fmt(t.n - t.synced)}` });
  }
  if (full && opts.classOn) {
    const unmapped = t.n - full.mapped;
    const unjudged = t.n - full.judged;
    lines.push({
      metric: "class",
      label: "반 미매핑",
      value: pctText(pct(unmapped, t.n)),
      // 아직 판정 안 한 기록(백필 전 옛 기록 · 녹음 상담처럼 저장 때 판정하지 않는 경로)은 저장값이 비어 미매핑으로 센다 — 그 수를 함께 밝힌다.
      sub: `미매핑 ${fmt(unmapped)}건${unjudged > 0 ? ` · 그중 아직 판정 안 한 기록 ${fmt(unjudged)}건` : ""}`,
    });
  }
  return lines;
}
