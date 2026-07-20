import { ClipboardList } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStaffResumes } from "@/features/staff/server/resume-queries";
import { canViewResume } from "@/features/staff/server/resume-access";
import { EditingBadge } from "@/features/presence/editing-badge";
import { NewResumeTrigger } from "./new-resume-trigger";

const PAGE_SIZE = 50;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" });

/** 입사일(YYYY-MM-DD)도 작성일과 같은 한국식 표기로 — 같은 표에서 형식이 갈리면 안 된다. */
const ymdLabel = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : ymd;
};

/**
 * 직원 이력서 면(/staff?tab=resumes) — 웹에서 작성한 이력서 목록. 작성본은 데이터베이스
 * (인사·직원, 사무실 전용 열람)에 저장되고, 여기와 /documents 양쪽에서 같은 행이 보인다.
 */
export async function ResumesFace({ page }: { page: number }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const [canWrite, { rows, total }] = await Promise.all([
    canWriteTenant(user.systemRole, "staff"),
    getStaffResumes(page, PAGE_SIZE),
  ]);
  // 목록 마스킹: 부서·입사일은 이력서(민감 섹션) 내용이라 상세와 **같은 게이트**(canViewResume)로 판정 —
  // 작성 본인·원장·재인증 창. 그 외 사무실은 이름/작성일/작성자(디렉터리 정보)만 보고, 열려면 상세에서 재인증한다.
  const visible = await Promise.all(rows.map((r) => canViewResume(user, r.id, r.uploadedBy)));
  const canSeeDetail = (i: number) => visible[i];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) =>
    p > 1 ? `/staff?tab=resumes&page=${p}` : "/staff?tab=resumes";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="micro">
          작성된 이력서 <span className="text-foreground font-bold">{total}</span>건
          <span className="text-text-faint ml-2 normal-case">
            · 서식을 웹에서 작성 — 데이터베이스(인사·직원)에 저장되고 A4로 인쇄할 수 있습니다
          </span>
        </p>
        {canWrite ? <NewResumeTrigger /> : null}
      </div>

      {total === 0 ? (
        <EmptyState
          image="documents"
          icon={() => <ClipboardList size={32} strokeWidth={1.8} />}
          title="작성된 이력서가 없습니다"
          description="'새 이력서'로 종이 서식과 같은 항목을 웹에서 입력하세요 — 인쇄·업로드 단계가 필요 없습니다."
        />
      ) : (
        <div className="bg-card border-line overflow-x-auto rounded-2xl border">
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
              {rows.map((r, i) => (
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
                    <EditingBadge scope={`staff-resume:${r.id}`} className="ml-1.5" />
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {canSeeDetail(i) ? r.department || "—" : <span className="text-text-faint">잠김</span>}
                  </td>
                  <td className="text-text-dim num px-3 py-2 whitespace-nowrap">
                    {canSeeDetail(i) ? (
                      r.startDate ? (
                        ymdLabel(r.startDate)
                      ) : (
                        "—"
                      )
                    ) : (
                      <span className="text-text-faint">잠김</span>
                    )}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(r.createdAt)}</td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.authorName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={total} />
    </section>
  );
}
