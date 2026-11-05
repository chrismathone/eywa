import { MessageSquareOff } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getRetentionRoster, getTenantName } from "@/features/retention/server/queries";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { MessageComposer } from "@/features/retention/components/message-composer";
import { RiskBadge } from "@/features/retention/components/risk-badge";

export const metadata = { title: "학부모 메시지 — 에이와" };

export default async function RetentionMessagesPage() {
  const user = await requireAccess("retention");
  const tId = await effectiveTeacherId();
  const [roster, academyName, canWrite] = await Promise.all([
    getRetentionRoster(tId ? { teacherId: tId } : undefined),
    getTenantName(),
    // '발송 조치 기록' 게이트(logRetentionAction)와 같은 판정 — 읽기 권한이면 그 단추를 그리지 않는다.
    canWriteTenant(user.systemRole, "retention"),
  ]);

  // 메시지 대상: 위험·관심 또는 상담 30일+ 공백 (부원장 getMessageQueue)
  const queue = roster
    .filter((r) => r.risk.level !== "ok" || (r.signals.daysSinceCounsel ?? 0) >= 30)
    .slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RetentionTabs />
        <p className="text-text-dim text-xs">실제 발송은 하지 않습니다 — 초안 복사 후 직접 전송하세요.</p>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          image="sends"
          icon={() => <MessageSquareOff size={32} strokeWidth={1.8} />}
          title="메시지 대상이 없습니다"
          description="위험·관심 학생이나 상담 공백 학생이 생기면 이곳에서 학부모 메시지 초안을 만들 수 있습니다."
        />
      ) : (
        <div className="space-y-3">
          {queue.map((r) => (
            <section key={r.id} className="bg-card border-line shadow-card rounded-2xl border p-4">
              <header className="mb-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-bold">
                    {r.name}{" "}
                    <span className="text-text-dim text-xs font-normal">
                      {[r.grade, r.school].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                  <p className="text-text-dim mt-0.5 truncate text-xs">
                    {r.risk.reasons.slice(0, 2).join(" · ")}
                  </p>
                </div>
                <RiskBadge level={r.risk.level} score={r.risk.score} />
              </header>
              <MessageComposer
                studentId={r.id}
                canWrite={canWrite}
                input={{
                  name: r.name,
                  level: r.risk.level,
                  scoreDrop: r.risk.scoreDrop,
                  lastScore: r.signals.lastScore,
                  homeworkRate: r.signals.homeworkRate,
                  reasons: r.risk.reasons,
                  memo: r.memo,
                  academyName,
                  directorName: user.displayName,
                }}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
