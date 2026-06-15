import { requireAccess } from "@/lib/auth/require-access";
import {
  getRetentionRoster,
  summarizeRoster,
  type RosterStudent,
} from "@/features/retention/server/queries";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { RetentionGauge } from "@/features/retention/components/retention-gauge";
import { PulseTiles } from "@/features/retention/components/pulse-tiles";
import { ActionQueue } from "@/features/retention/components/action-queue";
import { SignalSection, type SignalRow } from "@/features/retention/components/signal-section";
import { formatWonShort, ddayLabel } from "@/features/retention/format";

export const metadata = { title: "이탈 방어 — eywa" };

// new Date()를 컴포넌트 본문 밖 헬퍼로 분리(RSC purity 룰 회피). request당 1회 평가.
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function subOf(r: RosterStudent): string {
  return [r.grade, r.school].filter(Boolean).join(" · ") || "—";
}

export default async function RetentionPage() {
  const user = await requireAccess("retention");
  const roster = await getRetentionRoster(
    user.systemRole === "teacher" ? { teacherId: user.id } : undefined,
  );
  const stats = summarizeRoster(roster);
  const todayIso = isoToday();

  // 액션 큐: 위험·관심 또는 상담 30일+ 공백 또는 재등록 위험 (부원장 isActionable)
  const queue = roster
    .filter(
      (r) =>
        r.risk.level !== "ok" ||
        (r.signals.daysSinceCounsel ?? 0) >= 30 ||
        r.risk.renewal.tone === "risk",
    )
    .slice(0, 10);

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
      ? `위험 ${stats.risk}명 · 관심 ${stats.warn}명. 매출 위험 ${formatWonShort(stats.revenueRisk)} 규모입니다.`
      : "급한 위험 신호는 없습니다. 안정 학생 관리를 이어가세요.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RetentionTabs />
        <p className="text-text-dim text-[12px]">{headline}</p>
      </div>

      <RetentionGauge risk={stats.risk} warn={stats.warn} ok={stats.ok} />
      <PulseTiles stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
          <header className="border-line border-b px-5 py-4">
            <p className="micro">오늘 큐</p>
            <h2 className="text-foreground mt-1 text-[15px] font-bold">누구부터 챙길까</h2>
          </header>
          <ActionQueue rows={queue} />
        </section>

        <div className="space-y-4">
          <SignalSection title="오늘·지난 예정 연락" icon="wave" rows={overdue} empty="예정된 연락이 없습니다." />
          <SignalSection title="재등록 위험" icon="bell" rows={renewalRisk} empty="재등록 위험 학생이 없습니다." />
          <SignalSection title="상담 공백" icon="pulse" rows={counselGaps} empty="상담 공백 학생이 없습니다." />
        </div>
      </div>
    </div>
  );
}
