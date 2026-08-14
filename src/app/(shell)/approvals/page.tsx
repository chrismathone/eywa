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
 * 전자결재 결재함 — 원장 지시 2026-08-14: *"전자결재 페이지를 만들자. 그중에 휴가를 먼저 사용하는
 * 느낌으로."* 그룹웨어 표준 구성을 그대로 따른다: **기안 → 순차 결재선 → 결재대기/상신함/완료함**.
 *
 * 양식은 늘어날 자리다(지금은 휴가신청서 하나) — 문서 껍데기(`approval_documents`)와 양식 상세
 * (`leave_forms`)가 분리돼 있어 새 양식은 상세 표 + 폼만 더하면 된다.
 *
 * 접근은 `approvals` 메뉴 게이트 — 기본값이 전 역할 `none`이고 코드 명단(이승엽·김예원)이 개인
 * 예외로 얹힌다(파일럿). 상세는 [`access.ts`](../../../features/approvals/access.ts).
 */
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

  const face = sp.tab === "drafted" ? "drafted" : sp.tab === "done" ? "done" : "waiting";
  const faces: Face[] = [
    {
      key: "waiting",
      label: boxes.waiting.length > 0 ? `결재 대기 ${boxes.waiting.length}` : "결재 대기",
      href: "/approvals",
    },
    { key: "drafted", label: "상신함", href: "/approvals?tab=drafted" },
    { key: "done", label: "완료함", href: "/approvals?tab=done" },
  ];

  const period = balance.period;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="운영"
        title="전자결재"
        description="문서를 기안하면 결재선에 순서대로 올라갑니다. 지금은 휴가신청서를 쓸 수 있습니다."
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
          <span className="num">0212a</span>를 적용하면 바로 쓸 수 있습니다.
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

          {face === "waiting" ? (
            <DocList docs={boxes.waiting} emptyText="결재할 문서가 없습니다." />
          ) : face === "drafted" ? (
            <DocList
              docs={boxes.drafted}
              showDrafter={false}
              emptyText="올린 문서가 없습니다 — 위 ‘기안하기’로 시작하세요."
            />
          ) : (
            <DocList docs={boxes.done} emptyText="결재를 마친 문서가 없습니다." />
          )}
        </>
      )}
    </div>
  );
}
