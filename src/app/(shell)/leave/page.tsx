import { BigStat } from "@/components/atoms/big-stat";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { isLeaveApprover } from "@/features/leave/leave-access";
import { formatLeaveDays } from "@/features/leave/request-days";
import { getLeaveApprovalInbox, getMyLeaveOverview } from "@/features/leave/server/queries";
import { ApprovalInbox } from "./_components/approval-inbox";
import { MyRequests } from "./_components/my-requests";
import { RequestForm } from "./_components/request-form";

export const metadata = { title: "휴가관리 — eywa" };

/**
 * 휴가관리(연차 신청 + 전자결재) — 원장 지시 2026-08-14.
 *
 * 면 둘: **내 휴가**(연차 현황·신청·내 내역, 로그인한 본인 것) / **전자결재**(내가 결재자인 신청서).
 * 접근은 `leave` 메뉴 게이트 — 기본값이 전 역할 `none`이고 코드 명단(이승엽·김예원)이 개인 예외로
 * 얹혀 있다(파일럿). 상세는 [`leave-access.ts`](../../../features/leave/leave-access.ts).
 *
 * ⚠️ 부여 연차는 표가 아니라 **입사일에서 계산**한다(accrual.ts) — 입사일이 비어 있으면 계산할 수
 *    없으므로 신청 폼 대신 안내를 띄운다(사무실이 직원관리에서 입사일을 넣으면 즉시 계산된다).
 * 🔴 직원관리의 옛 '휴가 관리'(`/staff/leaves`, `staff_leaves` 0행)와 **파일럿 동안 일부러 분리**돼 있다 —
 *    합치는 절차는 0210a 마이그레이션 주석 참조(운영실 시그널이 그쪽에 물려 있어 지금 합치면 테스트
 *    신청이 원장 '오늘 할 일'에 뜬다).
 */
export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireAccess("leave");
  const sp = await searchParams;
  const canApprove = isLeaveApprover(user.id);
  const face = sp.tab === "approvals" && canApprove ? "approvals" : "my";

  // 두 면의 데이터는 서로 독립 — 한 번에 받는다(B4 직렬 워터폴 금지).
  const [overview, inbox] = await Promise.all([
    getMyLeaveOverview(user.id),
    canApprove
      ? getLeaveApprovalInbox(user.id)
      : Promise.resolve({ ready: true, loadError: null, rows: [] as never[] }),
  ]);

  const waiting = inbox.rows.filter((r) => r.status === "pending").length;
  const faces: Face[] = [
    { key: "my", label: "내 휴가", href: "/leave" },
    ...(canApprove
      ? [
          {
            key: "approvals",
            label: waiting > 0 ? `전자결재 ${waiting}` : "전자결재",
            href: "/leave?tab=approvals",
          },
        ]
      : []),
  ];

  const period = overview.period;
  const ready = overview.ready && inbox.ready;
  // 🔴 조회가 깨져도 페이지는 뜬다(2026-08-14 RLS 재귀로 창이 통째로 검게 죽은 뒤 규약) —
  //    무슨 일인지 한글로 보여주고, 원문은 툴팁에만 둔다.
  const loadError = overview.loadError ?? inbox.loadError;

  return (
    <div className="mx-auto w-full max-w-[980px] space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="운영"
        title="휴가관리"
        description="연차는 입사일 기준 법정 일수로 자동 계산됩니다. 신청하면 결재선에 전자결재가 올라갑니다."
        embedLabel="휴가관리 · 연차 신청과 전자결재"
      />

      {faces.length > 1 ? <FaceTabs faces={faces} active={face} ariaLabel="휴가관리 면 전환" /> : null}

      {loadError ? (
        <p
          className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-4 py-2.5 text-[13px]"
          title={loadError.raw}
        >
          {loadError.summary}
        </p>
      ) : null}

      {!ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          휴가관리 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0210a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : face === "approvals" ? (
        <ApprovalInbox rows={inbox.rows} />
      ) : (
        <>
          {period ? (
            <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <BigStat
                label="부여"
                value={formatLeaveDays(period.granted)}
                tone="primary"
                icon={<EyIcon name="calendarCheck" size={16} />}
                sub={period.label}
              />
              <BigStat label="사용(승인)" value={formatLeaveDays(overview.used)} tone="neutral" />
              <BigStat label="결재 대기" value={formatLeaveDays(overview.pending)} tone="amber" />
              <BigStat
                label="잔여"
                value={formatLeaveDays(overview.remaining)}
                tone={overview.remaining > 0 ? "blue" : "danger"}
                valueClass={overview.remaining > 0 ? undefined : "text-danger"}
                sub={leavePeriodLabel(period)}
              />
            </section>
          ) : null}

          {period?.monthly ? (
            <p className="text-text-dim border-line bg-bg-soft/50 rounded-xl border px-4 py-2.5 text-xs">
              입사 1년 미만입니다 — <b>1개월 개근마다 1일</b>씩 늘어나고(최대 11일), 사용 기간은{" "}
              <span className="num">{leavePeriodLabel(period)}</span>입니다. 지금까지{" "}
              <b>{period.monthsWorked ?? 0}개월</b>을 채워 {formatLeaveDays(period.granted)}이
              부여됐습니다.
            </p>
          ) : null}

          {period ? (
            <RequestForm
              periodEnd={period.end}
              remaining={overview.remaining}
              today={kstToday()}
            />
          ) : (
            <div className="border-line bg-card rounded-2xl border border-dashed p-8 text-center">
              <p className="text-foreground text-sm font-medium">입사일이 등록되지 않았습니다</p>
              <p className="text-text-dim mt-1 text-xs">
                연차는 입사일에서 계산합니다 — 사무실(직원관리)에 입사일 등록을 요청하면 바로 계산됩니다.
              </p>
            </div>
          )}

          <MyRequests rows={overview.requests} />
        </>
      )}
    </div>
  );
}
