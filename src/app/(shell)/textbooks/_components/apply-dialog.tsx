"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyTextbookPlan, previewTextbookApply } from "@/features/textbooks/server/plan-actions";
import type { ApplyPreview, ApplyPreviewRow, ClassTextbookPlanRow } from "@/features/textbooks/types";
import { DialogShell, FormError, useRun } from "./form-bits";

const OUTCOME: Record<ApplyPreviewRow["outcome"], { label: string; tone: string; title: string }> = {
  add: { label: "새 줄", tone: "text-primary", title: "그 교시에 줄을 하나 추가합니다" },
  fill: { label: "빈 칸 채움", tone: "text-green", title: "이미 있는 줄의 비어 있는 칸만 채웁니다" },
  "skip-filled": {
    label: "그대로 둠",
    tone: "text-text-faint",
    title: "이미 적혀 있어 손대지 않습니다 — 덮어쓰지 않습니다",
  },
  "skip-past": {
    label: "지난 날짜",
    tone: "text-text-faint",
    title: "이미 지난 수업입니다 — 계획을 소급해 넣지 않습니다(그 날 실제로 한 것은 시트에서 적어 주세요)",
  },
  "skip-full": {
    label: "줄이 가득 참",
    tone: "text-danger",
    title: "그 교시에 계획 줄이 이미 20개라 새 줄을 세울 수 없습니다 — 시트에서 안 쓰는 줄을 지워 주세요",
  },
};

/** "2026-09-17" → "9/17 (목)" */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? "";
  return `${m}/${d} (${dow})`;
}

/**
 * 기입 미리보기 → 반영.
 *
 * 🔴 미리보기와 기입은 **같은 배분 함수**(`buildLessonSchedule`)를 탄다 — 화면이 보여준 것과 실제로
 *    들어가는 것이 갈리지 않는다.
 * 🔴 확인 목록은 **게이트가 아니다**([[#77]]) — 서버가 기입 시점에 다시 계산한다. 그래서 미리보기를 본 뒤
 *    누군가 그 칸을 채웠다면 그 칸은 조용히 '그대로 둠'이 된다(덮어쓰기가 없으니 안전한 실패다).
 */
export function ApplyDialog({ plan, onClose }: { plan: ClassTextbookPlanRow; onClose: () => void }) {
  const { busy, error, setError, run } = useRun();
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void previewTextbookApply(plan.id).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.ok) setError(res.error);
      else setPreview(res.preview);
    });
    return () => {
      alive = false;
    };
  }, [plan.id, setError]);

  const rows = preview?.rows ?? [];
  const willWrite = rows.filter((r) => r.outcome === "add" || r.outcome === "fill").length;
  // ⚠️ 진도가 아직 빈 차수 — 기입은 **된다**(교재·페이지/시간이 들어간다). 막지 않고 알리기만 한다.
  // 🔑 **지금 쓰는 칸만** 센다 — 전체를 세면 지난 날짜·이미 적힌 칸까지 섞여 옆의 '기입 N칸'보다 큰 수가 된다.
  const emptyLessons = rows.filter(
    (r) => (r.outcome === "add" || r.outcome === "fill") && !r.progress && !r.homework,
  ).length;
  const untouched = rows.filter((r) => r.outcome === "skip-filled").length;
  const full = rows.filter((r) => r.outcome === "skip-full").length;
  const past = rows.filter((r) => r.outcome === "skip-past").length;

  return (
    <DialogShell
      title={`기입 미리보기 — ${plan.className} · ${plan.textbookTitle}`}
      description="빈 칸만 채웁니다. 이미 적혀 있는 칸은 그대로 둡니다."
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
                기입 <b className="num">{willWrite}</b>칸
              </span>
              {untouched > 0 ? (
                <span className="text-text-dim">
                  그대로 둠 <span className="num">{untouched}</span>칸
                </span>
              ) : null}
              {emptyLessons > 0 ? (
                <span className="text-text-dim" title="그 차수엔 교재·페이지/시간만 들어갑니다 — 진도는 나중에 적으면 됩니다">
                  진도 아직 없음 <span className="num">{emptyLessons}</span>칸
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
              {past > 0 ? (
                <span className="text-text-dim" title="이미 지난 수업엔 소급해 넣지 않습니다">
                  지난 날짜 <span className="num">{past}</span>칸
                </span>
              ) : null}
              {full > 0 ? (
                <span className="text-danger font-semibold" title="그 교시에 계획 줄이 이미 20개입니다">
                  줄이 가득 참 <span className="num">{full}</span>칸
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
                들어갈 칸이 없습니다 — 시작일 뒤에 이 축의 수업이 없거나 차수가 모두 비어 있습니다.
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
                    <col style={{ width: 92 }} />
                  </colgroup>
                  <thead className="bg-background sticky top-0 z-10">
                    <tr className="text-text-dim text-xs">
                      <th className="py-1.5 text-center font-bold">차수</th>
                      <th className="py-1.5 text-center font-bold">날짜</th>
                      <th className="py-1.5 text-center font-bold">교시</th>
                      <th className="py-1.5 text-left font-bold">진도</th>
                      <th className="py-1.5 text-left font-bold">과제</th>
                      <th className="py-1.5 text-center font-bold">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const o = OUTCOME[r.outcome];
                      return (
                        <tr key={`${r.date}|${r.slotStart}|${i}`} className="border-line-faint border-b last:border-0">
                          <td className="num py-1 text-center font-bold">{r.lessonNo}</td>
                          <td className="num py-1 text-center">{dayLabel(r.date)}</td>
                          <td className="num py-1 text-center">{r.periodLabel ?? r.slotStart}</td>
                          <td className="truncate py-1">{r.progress ?? <span className="text-text-faint">—</span>}</td>
                          <td className="truncate py-1">{r.homework ?? <span className="text-text-faint">—</span>}</td>
                          <td className={`py-1 text-center font-semibold ${o.tone}`} title={o.title}>
                            {o.label}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={busy || willWrite === 0}
                onClick={() => {
                  void run(() => applyTextbookPlan(plan.id)).then((res) => {
                    if (!res || !("result" in res)) return;
                    const r = res.result;
                    const tail = [
                      r.skipped > 0 ? `이미 적혀 있어 그대로 둠 ${r.skipped}칸` : "",
                      r.truncated > 0 ? `줄 상한(20)으로 못 넣음 ${r.truncated}칸` : "",
                    ].filter(Boolean);
                    // 🔴 한 칸도 안 들어갔으면 '완료'라고 하지 않는다 — 미리보기 뒤에 누가 그 칸을 채웠을 수
                    //    있고(그래서 안전하게 건너뛴 것이다), 성공 토스트는 그 사실을 감춘다.
                    if (r.applied === 0) {
                      toast.info(`기입할 칸이 없었습니다${tail.length > 0 ? ` — ${tail.join(" · ")}` : ""}`);
                    } else {
                      toast.success(
                        `기입 완료 — 새 줄 ${r.added}칸 · 빈 칸 채움 ${r.filled}칸${
                          tail.length > 0 ? ` · ${tail.join(" · ")}` : ""
                        }`,
                      );
                    }
                    onClose();
                  });
                }}
              >
                {busy ? "기입 중…" : `${willWrite}칸 기입`}
              </Button>
              <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
                닫기
              </Button>
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}
