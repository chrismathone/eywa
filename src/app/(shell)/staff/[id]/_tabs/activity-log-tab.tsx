import { History } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Pagination } from "@/components/pagination";
import { getStaffActivityLog, ACTIVITY_PAGE_SIZE } from "@/features/audit/server/activity-queries";
import { activitySummary, activityOpLabel, type ActivityOp } from "@/features/audit/activity";

const OP_COLOR: Record<ActivityOp, PillColor> = { INSERT: "primary", UPDATE: "blue", DELETE: "danger" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

/**
 * 직원 상세 "활동 로그" 탭 — 이 직원이 시스템에서 한 변경(생성·수정·삭제)을 최신순으로.
 * activity_log(0081a DB 트리거)가 소스 — 사무실(master/admin/manager)만 열람(RLS + 페이지 게이트 이중).
 * 책임추적: "누가·언제·무엇을 어떻게 바꿨나"를 자동 기록(앱에서 빠뜨려도 누락 없음).
 */
export async function ActivityLogTab({ userId, page }: { userId: string; page: number }) {
  const { rows, total } = await getStaffActivityLog(userId, page);
  const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const hrefForPage = (p: number) =>
    p > 1 ? `/staff/${userId}?tab=activity&page=${p}` : `/staff/${userId}?tab=activity`;

  if (total === 0) {
    return (
      <EmptyState
        icon={() => <History size={32} strokeWidth={1.5} />}
        title="기록된 활동이 없습니다"
        description="이 직원이 학생·반·수납 등 핵심 데이터를 생성·수정·삭제하면 여기에 자동으로 남습니다."
      />
    );
  }

  return (
    <section className="space-y-3">
      <p className="micro">
        활동 <span className="text-foreground font-bold">{total}</span>건
        <span className="text-text-faint ml-2 normal-case">· 핵심 데이터 변경을 자동 기록(책임추적)</span>
      </p>
      <ul className="bg-card border-line divide-line divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
            <Pill color={OP_COLOR[r.op]}>{activityOpLabel(r.op)}</Pill>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm break-keep">
                {activitySummary(r.table, r.op, r.targetLabel, r.changed)}
              </p>
              <p className="text-text-faint num mt-0.5 text-xs">{when(r.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} hrefForPage={hrefForPage} total={total} />
    </section>
  );
}
