import Link from "next/link";
import type { AttendanceMigration } from "@/features/timetable/import/master/attendance-types";

export function AttendanceMigrationPreview({
  migration,
}: {
  migration: AttendanceMigration;
}) {
  const { moves, retainedCells } = migration;
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
              {moves.map((m) => (
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
                    {m.fromClassName} · {m.fromTime ?? "하루 전체"}
                  </td>
                  <td className="px-3 py-2">
                    {m.toClassName} · {m.toTime ?? "하루 전체"}
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
