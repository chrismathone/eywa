import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { Initial } from "@/components/atoms/initial";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getWithdrawnStudents,
  REASON_LABEL,
  type WithdrawalReason,
} from "@/features/withdrawals/server/queries";

export const metadata = { title: "퇴원관리 — eywa" };

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

export default async function WithdrawalsPage() {
  await requireAccess("withdrawals");
  const rows = await getWithdrawnStudents();

  // 사유 통계
  const reasonCounts = new Map<string, number>();
  for (const r of rows) {
    const key = r.metadata?.reason
      ? REASON_LABEL[r.metadata.reason as WithdrawalReason]
      : (r.withdrawalReason ?? "미기재");
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxCount = topReasons[0]?.[1] ?? 1;

  // 최근 30일 퇴원
  const recent = rows.filter((r) => {
    const days = daysSince(r.withdrawnAt);
    return days !== null && days <= 30;
  }).length;

  return (
    <div className="space-y-5">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 퇴원" value={rows.length} icon="falling" color="rose" />
        <Stat label="최근 30일" value={recent} icon="pulse" color="danger" />
        <Stat label="주요 사유" value={topReasons.length} unit="가지" icon="branch" color="amber" />
        <Stat label="평균 일수" value={"—"} icon="rings" color="blue" />
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="falling" size={32} />}
          title="퇴원 학생이 없습니다"
          description="status='withdrawn' 학생이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* 최근 퇴원 리스트 */}
          <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
            <header className="border-line border-b px-5 py-4">
              <p className="micro">최근 퇴원</p>
              <h2 className="text-foreground mt-1 text-[15px] font-bold">학생 명단</h2>
            </header>
            <ul className="divide-line divide-y">
              {rows.map((r) => {
                const ago = daysSince(r.withdrawnAt);
                return (
                  <li key={r.id} className="hover:bg-bg-soft/50 px-5 py-3.5 transition">
                    <Link href={`/withdrawals/${r.id}`} className="flex items-center gap-3">
                      <Initial name={r.name} color="rose" size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground text-[13px] font-bold hover:underline">
                          {r.name}{" "}
                          <span className="text-text-dim text-[11px] font-normal">
                            {r.grade ?? "—"} · {r.school ?? "—"}
                          </span>
                        </p>
                        <p className="text-text-dim mt-0.5 text-[11px]">
                          {r.lastClassName ?? "수강 반 없음"}
                          {r.primaryTeacherName ? <> · {r.primaryTeacherName} 강사</> : null}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-foreground num text-[11px] font-semibold">
                          {r.withdrawnAt ?? "—"}
                        </p>
                        {ago !== null ? (
                          <p className="text-text-faint num text-[10px]">{ago}일 전</p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 사유 분석 */}
          <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
            <header className="border-line border-b px-5 py-4">
              <p className="micro text-amber">사유 분석</p>
              <h2 className="text-foreground mt-1 text-[15px] font-bold">상위 퇴원 사유</h2>
            </header>
            <div className="space-y-3 p-5">
              {topReasons.map(([reason, count]) => {
                const pct = (count / maxCount) * 100;
                return (
                  <div key={reason}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-foreground text-[12px] font-semibold">{reason}</span>
                      <span className="text-text-dim num text-[11px]">
                        <span className="text-foreground font-bold">{count}</span>명 ·{" "}
                        {((count / rows.length) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="bg-bg-soft h-2 overflow-hidden rounded-full">
                      <span
                        className="bg-rose block h-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* AI 인사이트 박스 */}
            <div className="border-line bg-amber-soft border-t px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="bg-amber/15 text-amber flex size-7 shrink-0 items-center justify-center rounded-md">
                  <EyIcon name="sparkle" size={13} />
                </span>
                <div>
                  <p className="text-amber font-mono text-[10px] font-bold tracking-wider uppercase">
                    인사이트
                  </p>
                  <p className="text-foreground mt-0.5 text-[12px] leading-relaxed">
                    {topReasons[0]
                      ? `현재 가장 빈번한 퇴원 사유는 "${topReasons[0][0]}"입니다. 추세 모니터링과 사전 상담 강화를 고려해 보세요.`
                      : "퇴원 사유가 등록되면 인사이트가 표시됩니다."}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  unit?: string;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "primary" | "rose" | "amber" | "danger" | "blue";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    rose: "bg-rose-soft text-rose",
    amber: "bg-amber-soft text-amber",
    danger: "bg-danger-soft text-danger",
    blue: "bg-blue-soft text-blue",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro truncate">{label}</p>
        <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        {unit ? <span className="text-text-dim text-xs">{unit}</span> : null}
      </p>
    </div>
  );
}
