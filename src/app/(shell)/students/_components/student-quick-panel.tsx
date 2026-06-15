"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { StudentQuickInfo } from "@/components/student-quick-popover";
import type { StudentSummary } from "@/features/students/server/queries";

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  prospect: { label: "예비", color: "amber" },
  consulted: { label: "상담완료", color: "blue" },
  enrolled: { label: "재원", color: "primary" },
  on_hold: { label: "휴원", color: "amber" },
  withdrawn: { label: "퇴원", color: "neutral" },
};

/**
 * 학생 행 클릭 → 우측 오버레이(Sheet)에 경량 요약. 풀페이지 이동 대신
 * 캔버스 위에 띄운다(단일캔버스). 헤더는 리스트가 이미 가진 데이터로 즉시
 * 렌더하고, 출석률·수납 등 무거운 요약은 open 시 1회 fetch(skeleton).
 * "상세 전체보기"는 기존 풀페이지 /students/[id].
 */
export function StudentQuickPanel({
  student,
  children,
}: {
  student: StudentQuickInfo;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // 클릭(이벤트 핸들러)에서 열고 1회만 fetch — effect 내 동기 setState 회피(#25).
  function openPanel() {
    setOpen(true);
    if (summary || loading) return; // 이미 받았거나 받는 중이면 재요청 안 함(반응속도)
    setLoading(true);
    setError(false);
    fetch(`/api/students/${student.id}/summary`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: StudentSummary) => setSummary(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  const statusMeta = student.status ? (STATUS_META[student.status] ?? null) : null;

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="flex cursor-pointer items-center gap-2.5 text-left"
      >
        {children}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="bg-background w-full max-w-[400px] overflow-y-auto p-6 sm:max-w-[400px]"
        >
          {/* 헤더 — 리스트 데이터로 즉시 렌더 (네트워크 0) */}
          <header className="border-line space-y-1 border-b pb-4">
            <p className="micro">빠른 보기</p>
            <div className="flex items-center gap-2">
              <h2 className="text-foreground text-xl font-bold">{student.name}</h2>
              {statusMeta ? <Pill color={statusMeta.color}>{statusMeta.label}</Pill> : null}
            </div>
            <p className="text-text-dim text-xs">
              {student.grade ?? "—"}
              {student.school ? <> · {student.school}</> : null}
              {student.primaryTeacherName ? <> · 담임 {student.primaryTeacherName}</> : null}
            </p>
          </header>

          {/* 요약 — open 시 on-demand fetch */}
          <div className="mt-4">
            {error ? (
              <p className="text-danger text-xs">요약을 불러오지 못했습니다.</p>
            ) : loading || !summary ? (
              <SummarySkeleton />
            ) : (
              <SummaryBody summary={summary} />
            )}
          </div>

          {/* 액션 — 기존 풀페이지 상세 */}
          <Link
            href={`/students/${student.id}`}
            className="bg-primary text-primary-foreground hover:bg-primary-hover mt-6 flex items-center justify-center gap-1.5 rounded-sm py-2.5 text-[13px] font-bold transition"
          >
            상세 전체보기
            <EyIcon name="arrowRight" size={13} />
          </Link>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SummaryBody({ summary }: { summary: StudentSummary }) {
  const a = summary.attendance;
  const b = summary.billing;
  const billingValue = b.unpaidCount === 0 ? "완납" : `${b.unpaidCount}건`;
  const billingSub =
    b.overdueCount > 0 ? `연체 ${b.overdueCount}건` : (b.latestPeriod ?? undefined);
  const billingTone: MetricTone = b.overdueCount > 0 ? "danger" : b.unpaidCount > 0 ? "amber" : "primary";

  return (
    <div className="space-y-4">
      {/* KPI 2 */}
      <div className="grid grid-cols-2 gap-2.5">
        <Metric
          label="출석률 (30일)"
          value={`${Math.round(a.rate)}%`}
          sub={`${a.present}/${a.total}회`}
          tone="primary"
        />
        <Metric label="미납" value={billingValue} sub={billingSub} tone={billingTone} />
      </div>

      {/* 출결 분해 */}
      <div className="border-line flex items-center justify-between rounded-md border px-3 py-2 text-[11px]">
        <span className="text-text-dim">
          결석 <span className="text-foreground font-semibold">{a.absent}</span> · 지각{" "}
          <span className="text-foreground font-semibold">{a.late}</span>
        </span>
        <span className="text-text-faint">최근 30일 {a.total}회</span>
      </div>

      {/* 수강 반 */}
      <div>
        <p className="micro mb-1.5">수강 반</p>
        {summary.enrollments.length === 0 ? (
          <p className="text-text-faint text-xs">활성 수강 없음</p>
        ) : (
          <ul className="space-y-1">
            {summary.enrollments.map((e, i) => (
              <li
                key={i}
                className="border-line flex items-center justify-between rounded-sm border px-2.5 py-1.5 text-xs"
              >
                <span className="text-foreground font-medium">{e.className}</span>
                <span className="flex items-center gap-1.5">
                  {e.onHold ? <Pill color="amber">휴원</Pill> : null}
                  <span className="text-text-dim">
                    {SUBJECT_META[e.subject]?.label ?? e.subject}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type MetricTone = "primary" | "amber" | "danger";

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: MetricTone;
}) {
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
