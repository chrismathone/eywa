import Link from "next/link";
import { BigStat } from "@/components/atoms/big-stat";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { formatLeaveDays } from "@/features/leave/request-days";
import { getApprovalBoxes, getMyLeaveBalance } from "@/features/approvals/server/queries";
import { DocList } from "./_components/doc-list";

export const metadata = { title: "전자결재 — eywa" };

/**
 * 전자결재 결재함 — 원장 지시 2026-08-14: *"하이웍스 기준으로 디자인 및 기능 따서 우리 디자인에 맞게."*
 * 하이웍스 문서함 구성을 그대로 옮겼다: **결재 대기(내 차례) / 결재 예정 / 진행 / 완료 / 반려·회수 / 참조**.
 *
 * 양식은 늘어날 자리다(지금은 휴가신청서 하나) — 문서 껍데기(`approval_documents`)와 양식 상세
 * (`leave_forms`)가 분리돼 있어 새 양식은 상세 표 + 폼만 더하면 된다.
 *
 * 접근은 `approvals` 메뉴 게이트 — 기본값이 전 역할 `none`이고 코드 명단(이승엽·김예원)이 개인
 * 예외로 얹힌다(파일럿). 상세는 [`access.ts`](../../../features/approvals/access.ts).
 */

/** 탭(하이웍스 문서함) 정의 — 어느 함이 어떤 문서를 담는지 설명 문구까지 여기 한 곳. */
const BOX_TABS = [
  {
    key: "all",
    label: "전체",
    empty: "관련 문서가 없습니다 — 위 ‘기안하기’로 시작하세요.",
    note: "내가 기안·결재·참조로 관련된 모든 문서입니다.",
  },
  {
    key: "waiting",
    label: "결재 대기",
    empty: "결재할 문서가 없습니다.",
    note: "내 차례인 문서와, 부재중에 후결로 넘어가 확인이 필요한 문서입니다.",
  },
  {
    key: "upcoming",
    label: "결재 예정",
    empty: "차례를 기다리는 문서가 없습니다.",
    note: "내가 결재선에 있지만 아직 내 차례가 오지 않은 문서입니다.",
  },
  {
    key: "progress",
    label: "진행",
    empty: "진행 중인 문서가 없습니다 — 위 ‘기안하기’로 시작하세요.",
    note: "내가 기안했거나 결재한, 아직 진행 중인 문서입니다.",
  },
  {
    key: "done",
    label: "완료",
    empty: "완료된 문서가 없습니다.",
    note: "승인으로 끝난, 내가 관여한 문서입니다.",
  },
  {
    key: "rejected",
    label: "반려·회수",
    empty: "반려되거나 회수된 문서가 없습니다.",
    note: "반려 또는 기안자 회수로 끝난, 내가 관여한 문서입니다.",
  },
  {
    key: "refs",
    label: "참조",
    empty: "참조로 지정된 문서가 없습니다.",
    note: "결재 없이 열람만 하도록 참조로 지정된 문서입니다.",
  },
] as const;

type BoxTabKey = (typeof BOX_TABS)[number]["key"];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireAccess("approvals");
  const sp = await searchParams;

  // 두 조회는 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [boxes, balance] = await Promise.all([
    getApprovalBoxes(user.id),
    getMyLeaveBalance(user.id),
  ]);

  const face: BoxTabKey = BOX_TABS.some((t) => t.key === sp.tab)
    ? (sp.tab as BoxTabKey)
    : "waiting";
  const faces: Face[] = BOX_TABS.map((t) => ({
    key: t.key,
    label:
      t.key === "waiting" && boxes.waiting.length > 0
        ? `결재 대기 ${boxes.waiting.length}`
        : t.label,
    href: t.key === "waiting" ? "/approvals" : `/approvals?tab=${t.key}`,
  }));

  // 탭 키 → 그 함의 문서 목록. 기안자 열은 "전부 내 문서"일 수 있는 진행 탭에서도 유지한다 —
  // 진행엔 내가 결재한 남의 문서도 섞여 있어 기안자가 정보다.
  const docsByTab: Record<BoxTabKey, typeof boxes.waiting> = {
    all: boxes.all,
    waiting: boxes.waiting,
    upcoming: boxes.upcoming,
    progress: boxes.inProgress,
    done: boxes.completed,
    rejected: boxes.rejected,
    refs: boxes.refDocs,
  };
  const activeTab = BOX_TABS.find((t) => t.key === face)!;

  const period = balance.period;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="운영"
        title="전자결재"
        description="문서를 기안하면 결재선에 순서대로 올라갑니다. 양식: 휴가신청서·품의서·지출결의서·수입결의서."
        embedLabel="전자결재 · 기안과 결재함"
        actions={
          <Button render={<Link href="/approvals/new" />}>
            <EyIcon name="plus" size={16} />
            기안하기
          </Button>
        }
      />

      {boxes.loadError ? (
        <p
          className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-4 py-2.5 text-[13px]"
          title={boxes.loadError.raw}
        >
          {boxes.loadError.summary}
        </p>
      ) : null}

      {!boxes.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          전자결재 표가 아직 준비되지 않았습니다 — 마이그레이션{" "}
          <span className="num">0213a</span>를 적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <>
          {/* 내 연차 현황 — 휴가가 첫 양식이라 결재함 위에 요약으로 둔다(기안 전에 잔여를 먼저 본다). */}
          {period ? (
            <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <BigStat
                label="연차 부여"
                value={formatLeaveDays(period.granted)}
                tone="primary"
                icon={<EyIcon name="calendarCheck" size={16} />}
                sub={period.label}
              />
              <BigStat label="사용" value={formatLeaveDays(balance.used)} tone="neutral" />
              <BigStat label="결재중" value={formatLeaveDays(balance.pending)} tone="amber" />
              <BigStat
                label="잔여"
                value={formatLeaveDays(balance.remaining)}
                tone={balance.remaining > 0 ? "blue" : "danger"}
                sub={leavePeriodLabel(period)}
              />
            </section>
          ) : (
            <p className="border-line bg-bg-soft/50 text-text-dim rounded-xl border px-4 py-2.5 text-xs">
              입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 등록을 요청하세요.
            </p>
          )}

          <FaceTabs faces={faces} active={face} ariaLabel="결재함 전환" />

          {activeTab.note ? (
            <p className="text-text-faint px-1 text-[11px]">{activeTab.note}</p>
          ) : null}

          <DocList docs={docsByTab[face]} emptyText={activeTab.empty} />
        </>
      )}
    </div>
  );
}
