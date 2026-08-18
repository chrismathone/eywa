"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { studentStatusMeta } from "@/features/students/status-labels";
import type { StudentSummary } from "@/features/students/server/queries";

/**
 * 학생 경량 요약 뷰 — 모바일 QuickPanel(Sheet)과 데스크톱 워크스페이스 창이
 * 동일하게 쓰는 presentational 컴포넌트(한 소스). 데이터 페칭은 호출부가 담당.
 * 과목 라벨·색은 학원설정(operations.subjects) 단일 소스(useSubjectMaps) — 하드코딩 금지.
 * 상태 라벨·색도 마찬가지로 studentStatusMeta 단일 소스 — 여기서 STATUS_META를 다시 만들지 말 것.
 */

export type StudentHeaderInfo = {
  id: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  status?: string | null;
  teacherNames?: string[]; // 과목별 담당 강사(단일 담임 대체)
};

export function StudentSummaryView({
  info,
  summary,
  loading,
  error,
  onOpenDetail,
}: {
  info: StudentHeaderInfo;
  summary: StudentSummary | null;
  loading: boolean;
  error: boolean;
  /** 데스크톱 창에서 "상세 전체보기"를 스포트라이트 창으로 열 때(없으면 일반 Link 이동 = 모바일). */
  onOpenDetail?: () => void;
}) {
  const name = summary?.name ?? info.name;
  const grade = summary?.grade ?? info.grade;
  const school = summary?.school ?? info.school;
  const status = summary?.status ?? info.status;
  const teacherNames = summary?.teacherNames ?? info.teacherNames ?? [];
  const statusMeta = studentStatusMeta(status);

  return (
    <div className="flex h-full flex-col">
      <header className="border-line space-y-1 border-b pb-4">
        <p className="micro">빠른 보기</p>
        <div className="flex items-center gap-2">
          <h2 className="text-foreground text-xl font-bold">{name}</h2>
          {statusMeta ? <Pill color={statusMeta.color}>{statusMeta.label}</Pill> : null}
        </div>
        <p className="text-text-dim text-xs">
          {grade ?? "—"}
          {school ? <> · {school}</> : null}
          {teacherNames.length > 0 ? <> · 담당 {teacherNames.join("·")}</> : null}
        </p>
      </header>

      <div className="mt-4 flex-1">
        {error ? (
          <p className="text-danger text-xs">요약을 불러오지 못했습니다.</p>
        ) : loading || !summary ? (
          <SummarySkeleton />
        ) : (
          <SummaryBody summary={summary} />
        )}
      </div>

      {onOpenDetail ? (
        <button
          type="button"
          onClick={onOpenDetail}
          className="bg-primary text-primary-foreground hover:bg-primary-hover mt-6 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-bold transition"
        >
          상세 전체보기
          <EyIcon name="arrowRight" size={13} />
        </button>
      ) : (
        <WindowLink
          href={`/students/${info.id}`}
          title={name}
          className="bg-primary text-primary-foreground hover:bg-primary-hover mt-6 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-bold transition"
        >
          상세 전체보기
          <EyIcon name="arrowRight" size={13} />
        </WindowLink>
      )}
    </div>
  );
}

type MetricTone = "primary" | "amber" | "danger";

function SummaryBody({ summary }: { summary: StudentSummary }) {
  const subjects = useSubjectMaps();
  const a = summary.attendance;
  const b = summary.billing;
  const billingValue = b.unpaidCount === 0 ? "완납" : `${b.unpaidCount}건`;
  const billingSub = b.overdueCount > 0 ? `연체 ${b.overdueCount}건` : (b.latestPeriod ?? undefined);
  const billingTone: MetricTone = b.overdueCount > 0 ? "danger" : b.unpaidCount > 0 ? "amber" : "primary";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Metric label="출석률 (30일)" value={`${Math.round(a.rate)}%`} sub={`${a.present}/${a.total}회`} tone="primary" />
        <Metric label="미납" value={billingValue} sub={billingSub} tone={billingTone} />
      </div>

      <div className="border-line flex items-center justify-between rounded-md border px-3 py-2 text-[11px]">
        <span className="text-text-dim">
          결석 <span className="text-foreground font-bold">{a.absent}</span> · 지각{" "}
          <span className="text-foreground font-bold">{a.late}</span>
        </span>
        <span className="text-text-faint">최근 30일 {a.total}회</span>
      </div>

      <div>
        <p className="micro mb-1.5">수강 반</p>
        {summary.enrollments.length === 0 ? (
          <p className="text-text-faint text-xs">활성 수강 없음</p>
        ) : (
          <ul className="space-y-1">
            {summary.enrollments.map((e, i) => (
              <li key={i} className="border-line flex items-center justify-between rounded-sm border px-2.5 py-1.5 text-xs">
                <span className="text-foreground font-medium">{e.className}</span>
                <span className="flex items-center gap-1.5">
                  {e.onHold ? <Pill color="amber">휴원</Pill> : null}
                  <span className="text-text-dim">{subjects.labelOf(e.subject)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: MetricTone }) {
  const TONE: Record<MetricTone, string> = {
    primary: "text-primary",
    amber: "text-amber",
    danger: "text-danger",
  };
  return (
    <div className="bg-bg-soft rounded-md px-3 py-2.5">
      <p className="text-text-dim text-[11px]">{label}</p>
      <p className={`mt-0.5 text-[20px] leading-none font-bold ${TONE[tone]}`}>{value}</p>
      {sub ? <p className="text-text-faint mt-1 text-[10px]">{sub}</p> : null}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-bg-soft h-[68px] animate-pulse rounded-md" />
        <div className="bg-bg-soft h-[68px] animate-pulse rounded-md" />
      </div>
      <div className="bg-bg-soft h-9 animate-pulse rounded-md" />
      <div className="bg-bg-soft h-16 animate-pulse rounded-md" />
    </div>
  );
}
