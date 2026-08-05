"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { setMyClassReviewFilter } from "@/features/class-review/server/actions";
import {
  CLASS_REVIEW_FILTERS,
  CLASS_REVIEW_FILTER_LABEL,
  type ClassReviewFilter,
} from "@/features/class-review/list-filter";

export type ReviewTableRow = {
  id: string;
  date: string;
  teacherName: string;
  subjectLabel: string | null;
  subjectColor: PillColor | null;
  mode: "assigned" | "open";
  modeLabel: string;
  /** 내가 평가할 자격이 있고 아직 미제출(본인 평가 포함 — '내가 평가할 것' 필터 대상). */
  myTurn: boolean;
  /** 내 채점이 이미 저장돼 있음('내가 평가함' 필터 대상). */
  myDone: boolean;
  submitted: string; // "2/4"
  percent: string | null;
  grade: string | null;
};

function matches(r: ReviewTableRow, f: ClassReviewFilter): boolean {
  if (f === "todo") return r.myTurn;
  if (f === "done") return r.myDone;
  if (f === "open") return r.mode === "open";
  return true;
}

/**
 * 참관 목록 표 — 행 전체 클릭 = 상세 이동(원장 지시 2026-08-04: 날짜만 클릭되던 것).
 * 보기 필터(전체/내가 평가할 것/내가 평가함/선착순, 원장 지시 2026-08-05)는 계정 귀속 —
 * 데이터는 이미 전부 내려와 있어 필터링은 클라에서 즉시, 저장은 다음 방문용 영속화(백그라운드).
 * 개수는 필터 전 집합 기준이라 무엇을 고르든 숫자가 안 변한다(0인 칸도 눌러 빈 목록 + 안내를 본다).
 */
export function ReviewTable({
  rows,
  initialFilter,
}: {
  rows: ReviewTableRow[];
  initialFilter: ClassReviewFilter;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ClassReviewFilter>(initialFilter);

  const counts = Object.fromEntries(
    CLASS_REVIEW_FILTERS.map((f) => [f, rows.filter((r) => matches(r, f)).length]),
  ) as Record<ClassReviewFilter, number>;
  const visible = rows.filter((r) => matches(r, filter));

  const pick = (next: ClassReviewFilter) => {
    if (next === filter) return;
    setFilter(next); // 화면은 즉시 — 저장 실패해도 이번 화면은 유지된다.
    void setMyClassReviewFilter(next).then((r) => {
      if (!r.ok) toast.error(r.error ?? "보기 설정을 저장하지 못했습니다");
    });
  };

  return (
    <div className="space-y-3">
      <span
        className="border-line-strong inline-flex flex-wrap items-center rounded-full border p-0.5"
        title="목록을 좁혀 봅니다(내 계정에 저장 — 다른 PC에서도 같은 상태로 열립니다)"
      >
        <span className="text-text-dim px-1.5 text-[11px] font-bold">보기</span>
        {CLASS_REVIEW_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => pick(f)}
            aria-pressed={filter === f}
            className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap transition ${
              filter === f ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
            }`}
          >
            {CLASS_REVIEW_FILTER_LABEL[f]}
            <span className={`num ml-1 ${filter === f ? "opacity-80" : "opacity-60"}`}>{counts[f]}</span>
          </button>
        ))}
      </span>

      {visible.length === 0 ? (
        <div className="border-line rounded-2xl border border-dashed p-10 text-center">
          <p className="text-text-dim text-sm">
            &lsquo;{CLASS_REVIEW_FILTER_LABEL[filter]}&rsquo; 보기에 해당하는 참관 건이 없습니다.
          </p>
        </div>
      ) : (
        <div className="border-line bg-card overflow-x-auto rounded-2xl border shadow-card">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-line bg-bg-soft/60 border-b text-left">
                <th className="px-4 py-2.5 font-semibold">참관일</th>
                <th className="px-4 py-2.5 font-semibold">강사</th>
                <th className="px-4 py-2.5 font-semibold">과목</th>
                <th className="px-4 py-2.5 font-semibold">평가 방식</th>
                <th className="px-4 py-2.5 text-right font-semibold">제출</th>
                <th className="px-4 py-2.5 text-right font-semibold">환산점수</th>
                <th className="px-4 py-2.5 text-right font-semibold">등급</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/class-review/${r.id}`)}
                  className="border-line/60 hover:bg-bg-soft/50 cursor-pointer border-b transition last:border-0"
                >
                  <td className="num text-primary px-4 py-2.5 font-medium">{r.date || "—"}</td>
                  <td className="px-4 py-2.5 font-medium">{r.teacherName || "—"}</td>
                  <td className="px-4 py-2.5">
                    {r.subjectLabel ? (
                      <Pill color={r.subjectColor ?? "neutral"} soft>
                        {r.subjectLabel}
                      </Pill>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {r.modeLabel}
                      {r.myTurn ? (
                        <Pill color="amber" soft>
                          내 평가 차례
                        </Pill>
                      ) : null}
                    </span>
                  </td>
                  <td className="num px-4 py-2.5 text-right">{r.submitted}</td>
                  <td className="num px-4 py-2.5 text-right font-semibold">{r.percent ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.grade ? (
                      <Pill color={r.grade === "재참관" ? "danger" : "primary"} soft>
                        {r.grade}
                      </Pill>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
