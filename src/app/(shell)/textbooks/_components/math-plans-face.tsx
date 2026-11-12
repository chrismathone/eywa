import Link from "next/link";
import type { MathAssignmentListRow } from "@/features/textbooks/server/math-assignment-queries";
import type { TextbookTableStatus } from "@/features/textbooks/types";

/**
 * 교재목록 · 반 배정 면(수학) — 반 교재·학생 교재 배정 목록. **읽기 전용**이다.
 * 배정은 수학 강사 시트(반 월간 화면)에서 한다 — 영어 반 배정 면과 같은 규약(고르는 곳은 시트, 여기는 보는 곳).
 */
export function MathPlansFace({ status, rows, mcsOn }: { status: TextbookTableStatus; rows: MathAssignmentListRow[]; mcsOn: boolean }) {
  if (status !== "ok") {
    return (
      <p className="text-text-dim px-1 py-8 text-center text-xs">
        {status === "missing-table"
          ? "수학 교재 배정 표가 아직 없습니다 — 마이그레이션(math_textbook_assignments)을 적용하면 열립니다."
          : "배정 목록을 불러오지 못했습니다. 새로고침해 주세요."}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-text-dim px-1 py-8 text-center text-xs">
        아직 배정된 수학 교재가 없습니다. 수학 강사 시트의 반 화면에서 반 교재·학생 교재를 배정합니다.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto px-1">
      <table className="w-full table-fixed border-collapse text-xs [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
        <colgroup>
          <col style={{ width: 200 }} />
          <col style={{ width: 140 }} />
          <col />
          <col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-text-dim text-center text-xs">
            <th className="rounded-l-md py-1.5 font-bold">반</th>
            <th className="py-1.5 font-bold">대상</th>
            <th className="py-1.5 font-bold">교재</th>
            <th className="rounded-r-md py-1.5 font-bold">배정일</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-line-faint border-b last:border-0">
              <td className="truncate py-1.5 pl-2">
                {mcsOn ? (
                  <Link href={`/mcs/${r.classId}/month`} className="hover:text-primary font-bold">
                    {r.className}
                  </Link>
                ) : (
                  <strong>{r.className}</strong>
                )}
              </td>
              <td className="truncate py-1.5 pl-2">
                {r.studentName ?? <span className="text-text-dim">반 전체</span>}
              </td>
              <td className="truncate py-1.5 pl-2">{r.title}</td>
              <td className="num py-1.5 text-center">{new Date(r.updatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
