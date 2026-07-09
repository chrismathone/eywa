import { ClipboardList, Plus } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStaffResumes } from "@/features/staff/server/resume-queries";

const PAGE_SIZE = 50;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });

/**
 * 직원 이력서 면(/staff?tab=resumes) — 웹에서 작성한 이력서 목록. 작성본은 데이터베이스
 * (인사·직원, 사무실 전용 열람)에 저장되고, 여기와 /documents 양쪽에서 같은 행이 보인다.
 */
export async function ResumesFace({ page }: { page: number }) {
  const user = await getCurrentUser();
  const canWrite = !!user && (await canWriteTenant(user.systemRole, "staff"));
  const all = await getStaffResumes();
  // 목록 마스킹: 부서·입사일은 이력서(민감 섹션) 내용이라, 상세와 동일하게 작성자 본인·원장에게만 노출.
  // 그 외 사무실은 이름/작성일/작성자(디렉터리 정보)만 보고, 열려면 상세에서 재인증한다.
  const isMaster = user?.systemRole === "master";
  const canSeeDetail = (uploadedBy: string | null) => isMaster || (!!user && uploadedBy === user.id);

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) =>
    p > 1 ? `/staff?tab=resumes&page=${p}` : "/staff?tab=resumes";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="micro">
          작성된 이력서 <span className="text-foreground font-bold">{all.length}</span>건
          <span className="text-text-faint ml-2 normal-case">
            · 서식을 웹에서 작성 — 데이터베이스(인사·직원)에 저장되고 A4로 인쇄할 수 있습니다
          </span>
        </p>
        {canWrite ? (
          <Button render={<WindowLink href="/staff/resumes/new" title="직원 이력서 작성" />}>
            <Plus className="size-4" />새 이력서
          </Button>
        ) : null}
      </div>

      {all.length === 0 ? (
        <EmptyState
          image="documents"
          icon={() => <ClipboardList size={32} strokeWidth={1.5} />}
          title="작성된 이력서가 없습니다"
          description="'새 이력서'로 종이 서식과 같은 항목을 웹에서 입력하세요 — 인쇄·업로드 단계가 필요 없습니다."
        />
      ) : (
        <div className="bg-card border-line overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-dim border-line border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">성명</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">근무부서</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">입사일</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">작성일</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">작성자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-line hover:bg-bg-soft/50 border-t transition-colors">
                  <td className="px-4 py-2">
                    <WindowLink
                      href={`/staff/resumes/${r.id}`}
                      title={`이력서 — ${r.name}`}
                      className="text-foreground hover:text-primary inline-flex items-center gap-2 font-medium hover:underline"
                    >
                      <ClipboardList className="text-rose size-4 shrink-0" />
                      {r.name}
                    </WindowLink>
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {canSeeDetail(r.uploadedBy) ? r.department || "—" : <span className="text-text-faint">잠김</span>}
                  </td>
                  <td className="text-text-dim num px-3 py-2 whitespace-nowrap">
                    {canSeeDetail(r.uploadedBy) ? r.startDate || "—" : <span className="text-text-faint">잠김</span>}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(r.createdAt)}</td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.authorName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={all.length} />
    </section>
  );
}
