import Link from "next/link";
import type { MasterInput, MasterPreview } from "@/features/timetable/import/master/types";

export function OmittedClasses({
  preview,
  input,
  pending,
  onChange,
}: {
  preview: MasterPreview;
  input: MasterInput;
  pending: boolean;
  onChange: (value: Partial<MasterInput>) => void;
}) {
  if (!preview.omittedClasses.length) return null;
  const selected = input.closeClassIds ?? preview.omittedClasses.map((c) => c.id);
  return (
    <section aria-label="시트에 없는 반" id="omitted-classes">
      <h2 className="text-lg font-semibold">시트에 없는 반 · 종강</h2>
      <p className="mt-1 text-sm text-text-dim">
        선택한 반은 적용일 전날로 종강하고 남은 학생의 수강을 종료합니다. 반 이름에 종료일을 붙이며,
        기존 수강·출결 이력은 보존합니다. 계속 운영할 반은 선택을 해제하세요.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {preview.omittedClasses.map((c) => {
          const term = preview.termClosures?.find((t) => t.classId === c.id);
          return (
            <div key={c.id} className="space-y-1 rounded border border-line p-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={pending}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    onChange({
                      closeClassIds: e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.name} · 종강
              </label>
              {term && selected.includes(c.id) ? (
                <>
                  <p>
                    종강일: {term.closedAt} · 변경 이름: {term.toName}
                  </p>
                  <p>
                    수강 종료 {term.students.length}명
                    {term.students.length ? ": " : " (반이동 학생 제외)"}
                    {term.students.map((s, i) => (
                      <span key={s.id}>
                        {i ? " · " : ""}
                        <Link
                          prefetch={false}
                          href={`/students/${s.id}`}
                          className="text-primary underline"
                        >
                          {s.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                <p className="text-text-dim">
                  선택 변경 후 다시 검사하면 종강 내역을 확인할 수 있습니다.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
