"use client";

import { useRouter } from "next/navigation";
import { Pill, type PillColor } from "@/components/atoms/pill";

export type BoardRow = {
  id: string;
  date: string;
  subjectLabel: string | null;
  subjectColor: PillColor | null;
  submitted: string; // "2/4"
  incomplete: boolean;
  areaSubs: number[] | null; // 영역별 소계(평균 기준) — 미채점이면 null
  total: number | null;
  percent: number | null;
  grade: string | null;
};

export type BoardGroup = {
  teacherName: string;
  avgPercent: number | null;
  avgGrade: string | null;
  rows: BoardRow[];
};

/**
 * 종합 표 — 강사 그룹 헤더 행(건수·평균 환산·등급) + 참관 건 행(영역 소계 → 총점 → 환산 → 등급).
 * 행 클릭 = 상세 이동(목록과 동일 규약). 영역 열 헤더는 ①②③…(툴팁 = 영역 제목, 각주에 범례).
 */
export function BoardTable({
  groups,
  areaHeads,
}: {
  groups: BoardGroup[];
  areaHeads: { short: string; title: string; max: number }[];
}) {
  const router = useRouter();
  const colCount = 6 + areaHeads.length;

  return (
    <div className="bg-card overflow-x-auto rounded-2xl shadow-card">
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr className="border-line bg-bg-soft/60 border-b text-left">
            <th className="text-text-dim px-4 py-2.5 text-xs font-medium">참관일</th>
            <th className="text-text-dim px-3 py-2.5 text-xs font-medium">과목</th>
            <th className="text-text-dim px-3 py-2.5 text-right text-xs font-medium">제출</th>
            {areaHeads.map((h) => (
              <th
                key={h.short}
                title={`${h.title} (${h.max}점 만점)`}
                className="text-text-dim w-12 px-2 py-2.5 text-center text-xs font-medium"
              >
                {h.short}
              </th>
            ))}
            <th className="text-text-dim px-3 py-2.5 text-right text-xs font-medium">총점</th>
            <th className="text-text-dim px-3 py-2.5 text-right text-xs font-medium">환산</th>
            <th className="text-text-dim px-4 py-2.5 text-right text-xs font-medium">등급</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => [
            <tr key={`h-${g.teacherName}`} className="border-line/60 bg-bg-soft/50 border-y">
              <td colSpan={colCount} className="px-4 py-2">
                <span className="text-foreground text-sm font-bold">{g.teacherName}</span>
                <span className="text-text-dim ml-2 text-xs">
                  참관 <span className="num">{g.rows.length}</span>회
                  {g.avgPercent !== null ? (
                    <>
                      {" "}
                      · 평균 환산 <span className="num font-bold">{g.avgPercent.toFixed(1)}</span>
                    </>
                  ) : null}
                </span>
                {g.avgGrade ? (
                  <span className="ml-2 align-middle">
                    <Pill color={g.avgGrade === "재참관" ? "danger" : "primary"} soft>
                      {g.avgGrade}
                    </Pill>
                  </span>
                ) : null}
              </td>
            </tr>,
            ...g.rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/class-review/${r.id}`)}
                className="border-line/50 hover:bg-bg-soft/50 cursor-pointer border-b transition last:border-0"
              >
                <td className="num px-4 py-2.5">{r.date || "—"}</td>
                <td className="px-3 py-2.5">
                  {r.subjectLabel ? (
                    <Pill color={r.subjectColor ?? "neutral"} soft>
                      {r.subjectLabel}
                    </Pill>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`num px-3 py-2.5 text-right ${r.incomplete ? "text-text-dim" : ""}`}>
                  {r.submitted}
                </td>
                {areaHeads.map((h, i) => (
                  <td key={h.short} className="num text-text-dim px-2 py-2.5 text-center">
                    {r.areaSubs ? r.areaSubs[i] : "—"}
                  </td>
                ))}
                <td className="num px-3 py-2.5 text-right font-medium">{r.total ?? "—"}</td>
                <td className="num px-3 py-2.5 text-right font-bold">
                  {r.percent !== null ? r.percent.toFixed(1) : "—"}
                </td>
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
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}
