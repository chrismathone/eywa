"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { previewTextbookApply } from "@/features/textbooks/server/plan-actions";
import type { ApplyPreview } from "@/features/textbooks/types";
import { DialogShell, FormError } from "./form-bits";

/** "2026-09-17" → "9/17 (목)" */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? "";
  return `${m}/${d} (${dow})`;
}

/**
 * 배정 한 건의 **월간계획 미리보기** — 읽기 전용이다.
 *
 * 🔴 **여기서 실제 칸에 쓰지 않는다**(원장 결정 D1, 2026-09-23). 예전엔 이 창의 [기입]이 배정을 그 반의
 *    실제 계획 줄로 옮겼는데, 09-22 결정(*"배정은 실제 칸에 한 줄도 안 쓴다 · 실제는 [월간계획 가져오기]로만"*)과
 *    어긋나 배정만으로 작성률이 올랐다. 실제로 옮기는 문은 영어 강사 시트의 [월간계획 가져오기] 하나뿐이다.
 * 🔑 계산은 시트와 **같은 배분 함수**(`buildLessonSchedule`)를 탄다 — 여기서 본 차수·날짜가 시트의 '계획'과 같다.
 */
export function PlanPreviewDialog({
  planId,
  className,
  textbookTitle,
  onClose,
}: {
  planId: string;
  className: string;
  textbookTitle: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    previewTextbookApply(planId)
      .then((res) => {
        if (!alive) return;
        setLoading(false);
        if (!res.ok) setError(res.error);
        else setPreview(res.preview);
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
        setError("미리보기를 불러오지 못했습니다");
      });
    return () => {
      alive = false;
    };
  }, [planId]);

  const rows = preview?.rows ?? [];
  const past = rows.filter((r) => r.outcome === "skip-past").length;

  return (
    <DialogShell
      title={`월간계획 미리보기 — ${className} · ${textbookTitle}`}
      description="이 배정으로 계산된 계획입니다. 실제 진도는 영어 강사 시트에서 [월간계획 가져오기]로 옮깁니다."
      onClose={onClose}
      size="xl"
    >
      <div className="flex flex-col gap-3">
        <FormError error={error} />
        {loading ? (
          <p className="text-text-dim py-6 text-center text-xs">계산하는 중…</p>
        ) : !preview ? null : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span>
                계획 <b className="num">{rows.length}</b>칸
              </span>
              {past > 0 ? (
                <span className="text-text-dim">
                  지난 날짜 <span className="num">{past}</span>칸
                </span>
              ) : null}
              {preview.skippedHolidays.length > 0 ? (
                <span
                  className="text-text-dim"
                  title={preview.skippedHolidays.map((h) => `${h.date} ${h.name}`).join(" · ")}
                >
                  휴일 건너뜀 <span className="num">{preview.skippedHolidays.length}</span>일
                </span>
              ) : null}
              {preview.unplaced.length > 0 ? (
                <span className="text-danger font-semibold" title={`${preview.unplaced.join(", ")}차수`}>
                  자리 없음 <span className="num">{preview.unplaced.length}</span>차수
                </span>
              ) : null}
            </div>

            {rows.length === 0 ? (
              <p className="text-text-dim py-6 text-center text-xs">
                계획에 설 칸이 없습니다 — 시작일 뒤에 고른 교시의 수업이 없습니다.
              </p>
            ) : (
              <div className="border-line-faint max-h-[48vh] overflow-y-auto rounded-lg border px-1">
                <table className="w-full border-collapse text-xs">
                  <colgroup>
                    <col style={{ width: 52 }} />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 76 }} />
                    <col />
                    <col />
                  </colgroup>
                  <thead className="bg-background sticky top-0 z-10">
                    <tr className="text-text-dim text-xs">
                      <th className="py-1.5 text-center font-bold">차수</th>
                      <th className="py-1.5 text-center font-bold">날짜</th>
                      <th className="py-1.5 text-center font-bold">교시</th>
                      <th className="py-1.5 text-left font-bold">진도</th>
                      <th className="py-1.5 text-left font-bold">과제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.date}|${r.slotStart}|${i}`}
                        className={`border-line-faint border-b last:border-0 ${r.outcome === "skip-past" ? "text-text-faint" : ""}`}
                      >
                        <td className="num py-1 text-center font-bold whitespace-nowrap">
                          {r.lessonNoEnd > r.lessonNo ? `${r.lessonNo}~${r.lessonNoEnd}` : r.lessonNo}
                        </td>
                        <td className="num py-1 text-center">{dayLabel(r.date)}</td>
                        <td className="num py-1 text-center">{r.periodLabel ?? r.slotStart}</td>
                        <td className="truncate py-1">{r.progress ?? <span className="text-text-faint">—</span>}</td>
                        <td className="truncate py-1">{r.homework ?? <span className="text-text-faint">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="flex">
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
