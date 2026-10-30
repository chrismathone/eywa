import { CalendarClock, Bell, MessageCircle } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import {
  getRetentionRoster,
  summarizeRoster,
  type RosterStudent,
} from "@/features/retention/server/queries";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { kstToday } from "@/lib/date-kst";
import { RetentionGauge } from "@/features/retention/components/retention-gauge";
import { PulseTiles } from "@/features/retention/components/pulse-tiles";
import { ActionQueue } from "@/features/retention/components/action-queue";
import { SignalSection, type SignalRow } from "@/features/retention/components/signal-section";
import { ddayLabel } from "@/features/retention/format";

export const metadata = { title: "이탈 방어 — 에이와" };

// KST 오늘(서버 UTC라 새벽 시간대 하루 밀림 방지). request당 1회 평가.
function isoToday(): string {
  return kstToday();
}
function subOf(r: RosterStudent): string {
  return [r.grade, r.school].filter(Boolean).join(" · ") || "—";
}

export default async function RetentionPage() {
  await requireAccess("retention");
  const tId = await effectiveTeacherId();
  const roster = await getRetentionRoster(tId ? { teacherId: tId } : undefined);
  const stats = summarizeRoster(roster);
  const todayIso = isoToday();

  // 액션 큐: 위험·관심 또는 상담 30일+ 공백 또는 재등록 위험 (부원장 isActionable)
  const actionable = roster.filter(
    (r) =>
      r.risk.level !== "ok" ||
      (r.signals.daysSinceCounsel ?? 0) >= 30 ||
      r.risk.renewal.tone === "risk",
  );
  const queue = actionable.slice(0, 10);

  const overdueSrc = roster.filter(
    (r): r is RosterStudent & { nextContactDate: string } =>
      !!r.nextContactDate && r.nextContactDate <= todayIso,
  );
  overdueSrc.sort((a, b) => (a.nextContactDate < b.nextContactDate ? -1 : 1));
  const overdue: SignalRow[] = overdueSrc.slice(0, 6).map((r) => ({
    id: r.id,
    name: r.name,
    sub: subOf(r),
    note: ddayLabel(r.nextContactDate, todayIso),
    noteTone: r.nextContactDate < todayIso ? "danger" : "amber",
  }));

  const renewalRisk: SignalRow[] = roster
    .filter((r) => r.risk.renewal.tone === "risk")
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      name: r.name,
      sub: subOf(r),
      note: `재등록 ${r.risk.renewal.label}`,
      noteTone: "danger",
    }));

  const counselGaps: SignalRow[] = roster
    .filter((r) => (r.signals.daysSinceCounsel ?? 999) >= 30)
    .sort((a, b) => (b.signals.daysSinceCounsel ?? 0) - (a.signals.daysSinceCounsel ?? 0))
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      name: r.name,
      sub: subOf(r),
      note: r.signals.daysSinceCounsel == null ? "상담 이력 없음" : `${r.signals.daysSinceCounsel}일 공백`,
      noteTone: "amber",
    }));

  const headline =
    stats.risk > 0
      ? "위험 신호가 있는 학생의 상담·출결·재등록을 확인하세요."
      : "급한 위험 신호는 없습니다. 안정 학생 관리를 이어가세요.";

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — 구 12px dim으로 격하돼 있던 headline 문장을 헤더 description으로 승격 */}
      <PageHeader eyebrow="학생 케어" title="이탈 방어" description={headline} />
      <RetentionTabs />

      <RetentionGauge risk={stats.risk} warn={stats.warn} ok={stats.ok} />
      <PulseTiles stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="bg-card shadow-card overflow-hidden rounded-2xl">
          {/* 명단은 펼쳐야 — 위 게이지·타일(요약)이 먼저(원장 2026-10-30 '요약 먼저, 이름은 눌러야'). */}
          <details>
            <summary className="border-line cursor-pointer border-b px-3 py-2">
              <p className="micro inline">오늘 큐</p>
              <h2 className="text-foreground mt-1 text-base font-bold">누구부터 챙길까 <span className="text-text-dim text-sm font-normal">· {actionable.length}명{actionable.length > queue.length ? ` 중 상위 ${queue.length}명` : ""} · 눌러서 보기</span></h2>
            </summary>
            <ActionQueue rows={queue} />
          </details>
        </section>

        <div className="space-y-4">
          <SignalSection title="오늘·지난 예정 연락" icon={CalendarClock} rows={overdue} empty="예정된 연락이 없습니다." />
          <SignalSection title="재등록 위험" icon={Bell} rows={renewalRisk} empty="재등록 위험 학생이 없습니다." />
          <SignalSection title="상담 공백" icon={MessageCircle} rows={counselGaps} empty="상담 공백 학생이 없습니다." />
        </div>
      </div>
    </div>
  );
}
