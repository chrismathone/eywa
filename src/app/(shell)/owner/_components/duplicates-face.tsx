import { Pagination } from "@/components/pagination";
import { findDuplicateStudents } from "@/features/admin/server/queries";
import { DuplicatesClient } from "@/app/(shell)/admin/duplicates/_client";

const PAGE_SIZE = 20;

/**
 * 중복 의심 학생 섹션 — 데이터 정리(owner ?tab=data) 면 하단에 DataFace와 함께 렌더(2026-06-29 통합).
 * ⚠️ findDuplicateStudents는 students 전건 fetch라 무거움 → data 면 진입 시에만 실행(조건부 렌더).
 * Pagination은 서버 컴포넌트라 embed를 모르므로, 창(embed) 컨텍스트를 pageHref가 직접 유지한다.
 */
export async function DuplicatesFace({ page, isEmbed }: { page: number; isEmbed: boolean }) {
  const allGroups = await findDuplicateStudents();
  const total = allGroups.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups = allGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const sp = new URLSearchParams({ tab: "data" });
    if (p > 1) sp.set("page", String(p));
    if (isEmbed) sp.set("embed", "1");
    return `/owner?${sp.toString()}`;
  };

  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 중복 병합</p>
        <h2 className="text-foreground text-lg font-bold">
          중복 의심 학생
          {total > 0 ? (
            <span className="text-muted-foreground num ml-2 text-base font-normal">
              {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
            </span>
          ) : null}
        </h2>
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
