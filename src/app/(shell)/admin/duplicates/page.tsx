import { BackLink } from "@/components/back-link";
import { Pagination } from "@/components/pagination";
import { requireAccess } from "@/lib/auth/require-access";
import { findDuplicateStudents } from "@/features/admin/server/queries";
import { DuplicatesClient } from "./_client";

export const metadata = { title: "중복 학생 — eywa" };

const PAGE_SIZE = 20;

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAccess("admin");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const allGroups = await findDuplicateStudents();
  const total = allGroups.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups = allGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => (p > 1 ? `/admin/duplicates?page=${p}` : "/admin/duplicates");

  return (
    <div className="space-y-6">
      <BackLink href="/admin" label="관리자 도구로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">관리 · 중복 병합</p>
        <h1 className="display text-foreground text-2xl">
          중복 의심 학생
          {total > 0 ? (
            <span className="text-muted-foreground num ml-2 text-base font-normal">
              {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
            </span>
          ) : null}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          이름·학년·학교가 같거나, 이름·학년이 같고 학부모 연락처가 동일한 학생들. 통합하면 모든
          수강·출석·수납·상담·메모가 보존할 학생으로 이전되고 나머지 중복 학생은 퇴원 처리됩니다.
        </p>
      </header>

      {total === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">중복 의심 학생이 없습니다</p>
      ) : (
        <>
          <DuplicatesClient groups={groups} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
