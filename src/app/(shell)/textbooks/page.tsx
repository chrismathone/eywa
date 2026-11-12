import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { FaceTabs } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { resolveTextbookSubject, resolveTextbookTab, textbookFaces, TEXTBOOK_SUBJECTS, type TextbookTab } from "@/features/textbooks/faces";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getMathAssignmentList } from "@/features/textbooks/server/math-assignment-queries";
import { MathPlansFace } from "./_components/math-plans-face";
import { getClassTextbookPlans, getTextbooks } from "@/features/textbooks/server/queries";
import { planDeletableClassIds } from "@/features/textbooks/server/plan-delete-access";
import type { TextbookTableStatus } from "@/features/textbooks/types";
import { BooksFace } from "./_components/books-face";
import { NotReadyBanner } from "./_components/not-ready-banner";
import { PlansFace } from "./_components/plans-face";
import { isModuleEnabled } from "@/lib/modules";

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
  // 과목 — 영어(기본) / 수학(원장 2026-10-19 *"기존에 교재목록은 영어만 사용했었는데 수학도 추가"*).
  const subject = resolveTextbookSubject(sp.subject);

  // 서로 독립 — 함께 받는다(B4).
  // ⚠️ 배정 면이 읽기 전용이 되면서(원장 2026-09-16) 반·교재 **선택지** 조회는 여기서 사라졌다 —
  //    고르는 화면이 영어 강사 시트로 옮겨갔고, 소비처 없는 조회를 남기면 면을 열 때마다 헛돈다.
  const [canWrite, canImport, settings, list, plans, mathPlans] = await Promise.all([
    canWriteTenant(user.systemRole, "textbooks"),
    // 엑셀로 넣기 = 학원 전체 일괄 작업 — 올리기 주소와 **같은 판정**(canManageTenant, full만 — #77).
    canManageTenant(user.systemRole, "textbooks"),
    getTenantSettings(),
    getTextbooks({
      subject,
      skillArea: sp.area ?? null,
      q: sp.q ?? null,
      page: Number(sp.page ?? 1) || 1,
    }),
    tab === "plans" && subject === "english"
      ? getClassTextbookPlans({})
      : Promise.resolve({ status: "ok" as TextbookTableStatus, rows: [] }),
    // 수학 '반 배정' 면 = 반·학생 교재 배정 목록(읽기 전용 — 배정은 수학 강사 시트에서 한다).
    // 🔴 표 없음(마이그레이션 미적용)은 그 면 안에서만 말한다 — 교재 면의 편집까지 잠그지 않는다.
    tab === "plans" && subject === "math" ? getMathAssignmentList(user.tenantId) : Promise.resolve(null),
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
  // 영어 반 배정 면의 [배정 삭제] — 서버(deleteClassTextbookPlan)와 같은 반 단위 ECS 쓰기 게이트로 반을 고른다.
  // 그 밖의 반엔 단추를 그리지 않는다(원장 2026-11-05 — 열람자 전원에게 떠서 눌러야 거절됐다).
  const deletableClassIds =
    tab === "plans" && !mathPlans && plans.status === "ok" && plans.rows.length > 0
      ? await planDeletableClassIds(plans.rows.map((p) => p.classId))
      : [];

  // ECS 계획 줄의 '구분'과 **같은 목록**을 쓴다(학원설정 단일 소스) — 여기서 따로 적으면 시트와 갈린다.
  // 수학엔 영역 축이 없다(설정에 skillAreas가 없으면 빈 목록 → 화면이 '구분'을 감춘다).
  const subjectSetting = settings.operations.subjects.find((s) => s.key === subject);
  const skillAreas = resolveSkillAreas(subjectSetting);
  // 과목 전환 라벨은 학원설정 단일 소스(`labelOf`) — 코드에 '영어'·'수학'을 적지 않는다.
  const { labelOf } = buildSubjectMaps(settings.operations.subjects);
  const subjectOptions = TEXTBOOK_SUBJECTS.map((key) => ({ key, label: labelOf(key) }));

  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <PageHeader
        eyebrow="수업"
        title="교재목록"
        description={
          subject === "math"
            ? "교재 한 권 = 페이지/시간·차수. 수학 강사 시트에서 반 교재나 학생별 교재로 배정합니다."
            : "교재 한 권 = 구분·페이지/시간·차수. 차수별 진도·과제를 적어 두면 영어 강사 시트의 월간계획에 차수대로 뜹니다."
        }
        embedLabel="교재 · 차수별 진도·과제 · 반 배정"
      />
      <NotReadyBanner status={status} />
      {/* ⚠️ 배지는 **거르지 않았을 때만** 숫자를 단다 — 검색 중에 `교재 6`이 뜨면 전체가 6권인 줄 안다. */}
      <FaceTabs
        faces={textbookFaces({
          books: sp.q || sp.area ? null : list.total,
          plans:
            tab !== "plans"
              ? null
              : mathPlans
                ? mathPlans.status === "ok" ? mathPlans.rows.length : null
                : plans.status === "ok" ? plans.rows.length : null,
        }, subject)}
        active={tab}
        ariaLabel="교재목록 면 전환"
      />
      {tab === "plans" && mathPlans ? (
        <MathPlansFace
          status={mathPlans.status}
          rows={mathPlans.rows}
          mcsOn={isModuleEnabled(settings.modules.disabled, "mcs")}
        />
      ) : tab === "plans" ? (
        <PlansFace rows={plans.rows} skillAreas={skillAreas} deletableClassIds={deletableClassIds} />
      ) : (
        <BooksFace
          rows={list.rows}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          skillAreas={skillAreas}
          subject={subject}
          subjectOptions={subjectOptions}
          canWrite={editable}
          canImport={canImport && list.status === "ok"}
        />
      )}
    </div>
  );
}
