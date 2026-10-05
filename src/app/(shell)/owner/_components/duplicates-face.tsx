import { Pagination } from "@/components/pagination";
import { MERGE_SCOPE_LABEL } from "@/features/admin/merge-scope";
import { findDuplicateStudents, type DuplicateGroup } from "@/features/admin/server/queries";
import { DuplicatesClient } from "@/app/(shell)/admin/duplicates/_client";

const PAGE_SIZE = 20;

/**
 * 중복 의심 학생 섹션 — 데이터 정리(owner ?tab=data) 면 하단에 DataFace와 함께 렌더(2026-06-29 통합).
 * ⚠️ findDuplicateStudents는 students 전건 fetch라 무거움 → data 면 진입 시에만 실행(조건부 렌더).
 * Pagination은 서버 컴포넌트라 embed를 모르므로, 창(embed) 컨텍스트를 pageHref가 직접 유지한다.
 *
 * `canManage` = 병합할 수 있는가 — page.tsx가 **병합 액션과 같은 판정**으로 정해 넘긴다(후보 조회와는 무관).
 */
export async function DuplicatesFace({ page, isEmbed, canManage }: { page: number; isEmbed: boolean; canManage: boolean }) {
  // 조회 헬퍼는 규약상 던진다 — 그대로 새면 데이터 정리 면 전체가 죽는다. 이 구획 안에서 한글 안내로 접는다(같은 이름 점검과 같은 방식).
  let allGroups: DuplicateGroup[] = [];
  let failed = false;
  try {
    allGroups = await findDuplicateStudents();
  } catch (error) {
    console.error("[owner/duplicates-face] 중복 의심 학생 조회 실패", error);
    failed = true;
  }
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
        {/* 🔴 옮기는 기록은 병합 액션과 **같은 목록**에서 적는다(merge-scope.ts) — "모든 기록"이라고 적지 않는다.
            목록에 없는 기록은 옮겨지지 않고 퇴원 처리된 학생에게 남는다. */}
        <p className="text-muted-foreground mt-1 text-sm">
          이름·학년·학교가 같거나, 이름·학년이 같고 학부모 연락처가 동일하거나, 동기화가 이름 겹침으로
          자동 구분(접미사)한 학생들. 무엇이 같아서 후보인지는 그룹마다 표시됩니다. 통합하면{" "}
          <b>{MERGE_SCOPE_LABEL}</b> 기록이 보존할 학생에게 옮겨지고 나머지 중복 학생은 퇴원 처리됩니다. 그 밖의
          기록(수업 보고서 · 진도 · 레벨테스트 · 교재 요청 등)은 옮겨지지 않고 퇴원 처리된 학생에게 남습니다.
          통합은 되돌릴 수 없습니다.
        </p>
      </header>

      {failed ? (
        <p role="alert" className="text-danger py-12 text-center text-sm">
          중복 의심 학생을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요
        </p>
      ) : total === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">중복 의심 학생이 없습니다</p>
      ) : (
        <>
          <DuplicatesClient groups={groups} canManage={canManage} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
