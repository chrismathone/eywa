"use client";

// 선생님 원스크린 "발송 현황" 뷰(5단계-1) — 읽기 중심 상태 보드.
// 오늘 (학생×과목)별 미작성/작성중/발송 + ClassNote 상태 + 학부모 열람을 한눈에. 행 클릭 → 그 학생 카드로.
// 신규 쿼리 없음: 이미 로드된 students(발송·열람) + reports state(초안)만 사용.
import { buildGridRows } from "../grid";
import { rowSendStatus, summarizeSend } from "../status";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, type SubjectReport } from "./report-card";

const STATUS_META: Record<
  "sent" | "draft" | "todo",
  { label: string; cls: string }
> = {
  sent: { label: "발송완료", cls: "bg-primary/10 text-primary" },
  draft: { label: "작성중", cls: "bg-amber-soft text-amber" },
  todo: { label: "미작성", cls: "bg-danger/10 text-danger" },
};

function Chip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-md px-3 py-1.5 ${tone}`}>
      <span className="text-[18px] font-bold tabular">{value}</span>
      <span className="ml-1 text-[12px] font-semibold">{label}</span>
    </div>
  );
}

export function StatusBoard({
  students,
  reports,
  onOpenCard,
}: {
  students: OneScreenStudent[];
  reports: Record<string, Record<string, SubjectReport>>;
  onOpenCard: (studentId: string) => void;
}) {
  const rows = buildGridRows(students);
  const sum = summarizeSend(rows, reports);

  if (rows.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm">
        오늘 담당 학생이 없습니다
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 요약 — 미작성이 핵심(빨강). 발송·열람은 진척. */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="미작성" value={sum.todo} tone="bg-danger/10 text-danger" />
        <Chip label="작성중" value={sum.draft} tone="bg-amber-soft text-amber" />
        <Chip label="발송완료" value={sum.sent} tone="bg-primary/10 text-primary" />
        <Chip label="학부모 열람" value={sum.viewed} tone="border-line text-text-dim border" />
        <span className="text-text-faint ml-auto text-[12px]">
          아직 안 보낸 {sum.unsent} / 전체 {sum.total}
        </span>
      </div>

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead>
            <tr className="border-line text-text-faint border-b">
              <th className="px-3 py-2 font-semibold">학생 · 반</th>
              <th className="px-3 py-2 font-semibold">오늘 진도</th>
              <th className="px-3 py-2 font-semibold">보고서</th>
              <th className="px-3 py-2 font-semibold">ClassNote</th>
              <th className="px-3 py-2 text-right font-semibold">열람</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rep = reports[r.student.id]?.[r.subject.name];
              const status = rowSendStatus(rep, r.subject);
              const meta = STATUS_META[status];
              const badge = classnoteBadge(rep?.classnoteStatus);
              const views = rep?.viewCount ?? 0;
              return (
                <tr
                  key={r.key}
                  onClick={() => onOpenCard(r.student.id)}
                  className={`border-line hover:bg-bg-soft cursor-pointer border-b last:border-b-0 ${
                    status === "todo" ? "bg-danger/5" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="text-foreground font-semibold">{r.student.name}</span>
                    <span className="text-text-faint ml-1.5">
                      {r.subject.name}
                      {r.student.className ? ` · ${r.student.className}` : ""}
                    </span>
                    {r.student.attendance !== "출석" ? (
                      <span
                        className={`ml-1.5 rounded-pill px-1.5 py-px text-[10px] font-semibold ${
                          r.student.attendance === "지각" ? "bg-amber-soft text-amber" : "bg-danger text-white"
                        }`}
                      >
                        {r.student.attendance}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-text-dim px-3 py-2">{r.subject.today?.trim() || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="px-3 py-2">
                    {badge ? (
                      <span className={`text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>
                    ) : (
                      <span className="text-text-faint text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {views > 0 ? (
                      <span className="text-text-dim tabular text-[11px]">{views}회</span>
                    ) : (
                      <span className="text-text-faint text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
