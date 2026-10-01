import Link from "next/link";
import type { AttendanceMigration } from "@/features/timetable/import/master/attendance-types";

export function AttendanceMigrationPreview({
  migration,
}: {
  migration: AttendanceMigration;
}) {
  const { moves, retainedCells } = migration;
  const entries = [
    ...new Map(
      moves.map((m) => [
        m.absenceDay
          ? JSON.stringify([m.studentId, m.date, m.fromClassId, m.toClassId])
          : m.ids[0],
        m,
      ]),
    ).values(),
  ];
  if (!moves.length && !retainedCells) return null;
  return (
    <section aria-label="기존 출결 이관" className="space-y-3">
      <h2 className="text-lg font-semibold">기존 출결 이관</h2>
      <p className="text-sm text-text-dim">
        이관 {moves.length}칸 · 같은 반·교시에서 유지 {retainedCells}칸. 출결
        상태·시수·메모·입력자·정정 이력을 보존합니다. 적용일 전 기록은
        유지됩니다.
      </p>
      {moves.length ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface">
              <tr>
                {["학생", "날짜", "이전 반 · 교시", "변경된 반 · 교시"].map(
                  (label) => (
                    <th key={label} className="whitespace-nowrap px-3 py-2">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((m) => (
                <tr key={m.ids[0]} className="border-t border-line">
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      prefetch={false}
                      className="text-primary underline"
                      href={`/students/${m.studentId}`}
                    >
                      {m.studentName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{m.date}</td>
                  <td className="px-3 py-2">
                    {m.fromClassName} ·{" "}
                    {m.absenceDay?.fromTimes.join(" · ") ??
                      m.fromTime ??
                      "하루 전체"}
                  </td>
                  <td className="px-3 py-2">
                    {m.toClassName} ·{" "}
                    {m.absenceDay?.toTimes.join(" · ") ??
                      m.toTime ??
                      "하루 전체"}
                    {m.absenceDay ? (
                      <p className="mt-1 text-xs text-text-dim">
                        전교시 사전 결석 {m.absenceDay.fromTimes.length}칸 →{" "}
                        {m.absenceDay.toTimes.length}칸. 같은 결석·메모를 새
                        반의 각 교시에 연결하며 원본 기록은 모두 보존합니다.
                      </p>
                    ) : null}
                    {m.seatChange ? <p className="mt-1 text-xs text-text-dim">
                      {m.seatChange.from} → {m.seatChange.to ?? "일반 수업"}.
                      적용일부터 새 시간표의 수업 구분으로 출결을 연결합니다.
                    </p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
