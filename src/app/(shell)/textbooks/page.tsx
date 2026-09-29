import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { ExcelImportButton } from "@/components/excel-import/excel-import-button";
import { FaceTabs } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { resolveTextbookTab, textbookFaces, type TextbookTab } from "@/features/textbooks/faces";
import { getClassTextbookPlans, getTextbooks } from "@/features/textbooks/server/queries";
import type { TextbookTableStatus } from "@/features/textbooks/types";
import { BooksFace } from "./_components/books-face";
import { NotReadyBanner } from "./_components/not-ready-banner";
import { PlansFace } from "./_components/plans-face";

type Sp = Record<string, string | undefined>;

const TITLE_SUFFIX: Record<TextbookTab, string> = { books: "", plans: " · 반 배정" };

// 면마다 문서 제목을 달리해 창 타이틀바가 "교재목록 · 반 배정"으로 라이브 갱신된다(route-window 관찰).
// ⚠️ 접두 "교재목록"은 사이드바 라벨(navigation.ts)과 같아야 한다.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const tab = resolveTextbookTab((await searchParams).tab);
  return { title: `교재목록${TITLE_SUFFIX[tab]} — 에이와` };
}

/**
 * 교재목록 — 수업 교재 마스터(구분·페이지/시간·차수)와 차수별 진도·과제, 그리고 그걸 반에 태우는 배정.
 * 원장 2026-09-16 지시로 신설(0266a).
 *
 * 🔴 **수납관리의 '교재 단가표'(`textbook_catalog`)와 다른 물건이다** — 그쪽은 makeedu와 동기화되는 금액
 *    표고 이쪽은 커리큘럼이다. 합치면 교재신청·수강료 계산기 picker에 커리큘럼 300종이 쏟아진다.
 *
 * 접근 = `textbooks` 메뉴(사무실 full / 강사 readonly = 고르기만). 쓰기 판정은 화면·액션이 **같은 함수**
 * (`canWriteTenant`)를 쓴다([[#77]]). 표가 아직 없으면(0266a 미적용) 화면은 살고 편집만 잠긴다([[#95]]).
 * ⚠️ **반 배정 면은 읽기 전용이다**(원장 2026-09-16) — 배정을 만드는 곳은 영어 강사 시트의 월간 화면이고,
 *    거기서 교시를 골라 건다. 그 게이트는 `textbooks`가 아니라 `ecs`(그 반의 쓰기 권한)라 교재 마스터를
 *    못 고치는 담임 강사도 자기 반엔 교재를 태운다 — 판정은 서버 액션이 반 단위로 다시 한다.
 */
export default async function TextbooksPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const user = await requireAccess("textbooks");
  const sp = await searchParams;
  const tab = resolveTextbookTab(sp.tab);

  // 서로 독립 — 함께 받는다(B4).
  // ⚠️ 배정 면이 읽기 전용이 되면서(원장 2026-09-16) 반·교재 **선택지** 조회는 여기서 사라졌다 —
  //    고르는 화면이 영어 강사 시트로 옮겨갔고, 소비처 없는 조회를 남기면 면을 열 때마다 헛돈다.
  const [canWrite, canImport, settings, list, plans] = await Promise.all([
    canWriteTenant(user.systemRole, "textbooks"),
    // 엑셀로 넣기 = 학원 전체 일괄 작업 — 올리기 주소와 **같은 판정**(canManageTenant, full만 — #77).
    canManageTenant(user.systemRole, "textbooks"),
    getTenantSettings(),
    getTextbooks({
      subject: "english",
      skillArea: sp.area ?? null,
      q: sp.q ?? null,
      page: Number(sp.page ?? 1) || 1,
    }),
    tab === "plans" ? getClassTextbookPlans({}) : Promise.resolve({ status: "ok" as TextbookTableStatus, rows: [] }),
  ]);

  // 표 없음(missing-table)이 그냥 실패보다 먼저 — 원인을 말하는 문구가 뜬다.
  const status: TextbookTableStatus =
    list.status === "missing-table" || plans.status === "missing-table"
      ? "missing-table"
      : list.status === "failed" || plans.status === "failed"
        ? "failed"
        : "ok";
  // 🔴 잠금은 **면마다 제 조회 상태**로 판단한다 — 교재 목록 조회가 한 번 실패했다고 다른 면까지 잠그면
  //    고칠 수 있는 일을 못 하게 막는 셈이다(그 반대도 마찬가지).
  const editable = canWrite && list.status === "ok";

  // ECS 계획 줄의 '구분'과 **같은 목록**을 쓴다(학원설정 단일 소스) — 여기서 따로 적으면 시트와 갈린다.
  const skillAreas = resolveSkillAreas(settings.operations.subjects.find((s) => s.key === "english"));

  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <PageHeader
        eyebrow="수업"
        title="교재목록"
        description="교재 한 권 = 구분·페이지/시간·차수. 차수별 진도·과제를 적어 두면 영어 강사 시트의 월간계획에 차수대로 뜹니다."
        embedLabel="교재 · 차수별 진도·과제 · 반 배정"
        actions={canImport && list.status === "ok" ? <ExcelImportButton kind="textbooks" variant="ghost" label="엑셀로 넣기" /> : null}
      />
      <NotReadyBanner status={status} />
      {/* ⚠️ 배지는 **거르지 않았을 때만** 숫자를 단다 — 검색 중에 `교재 6`이 뜨면 전체가 6권인 줄 안다. */}
      <FaceTabs
        faces={textbookFaces({
          books: sp.q || sp.area ? null : list.total,
          plans: plans.status === "ok" && tab === "plans" ? plans.rows.length : null,
        })}
        active={tab}
        ariaLabel="교재목록 면 전환"
      />
      {tab === "plans" ? (
        <PlansFace rows={plans.rows} skillAreas={skillAreas} />
      ) : (
        <BooksFace
          rows={list.rows}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          skillAreas={skillAreas}
          canWrite={editable}
        />
      )}
    </div>
  );
}
