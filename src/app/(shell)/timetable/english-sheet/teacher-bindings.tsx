"use client";

import { Button } from "@/components/ui/button";
import type {
  MasterInput,
  MasterPreview,
} from "@/features/timetable/import/master/types";

export function TeacherBindings({
  preview,
  input,
  pending,
  onChange,
}: {
  preview: Pick<MasterPreview, "teachers" | "teacherMappings">;
  input: MasterInput;
  pending: boolean;
  onChange: (patch: Partial<MasterInput>) => void;
}) {
  const select = (name: string, id: string) =>
    onChange({ teacherBindings: { ...input.teacherBindings, [name]: id } });
  return (
    <section aria-label="강사 연결" id="teacher-bindings">
      <h2 className="text-lg font-semibold">강사 연결</h2>
      <p className="mt-1 text-sm text-text-dim">
        영어 이름 또는 원본의 한글 이름이 활성 계정과 유일하게 일치하면 자동
        연결합니다. 자동 연결되지 않거나 담당자가 다르면 직접 선택하세요.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {preview.teacherMappings.map((m) => {
          const selected =
            input.teacherBindings?.[m.sheetName] ?? m.teacherId ?? "";
          return (
            <div key={m.sheetName} className="space-y-2 text-sm">
              <label className="block space-y-1">
                <span>{m.header}</span>
                <select
                  className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm disabled:opacity-60"
                  aria-label={`${m.sheetName} 강사 연결`}
                  disabled={pending}
                  value={selected}
                  onChange={(e) => select(m.sheetName, e.target.value)}
                >
                  <option value="">강사를 선택해 주세요</option>
                  {preview.teachers.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-text-dim">
                {Object.hasOwn(input.teacherBindings ?? {}, m.sheetName)
                  ? "직접 선택"
                  : m.method === "header"
                    ? `자동 연결 · 원본 한글 이름 일치: ${m.suggestedName}`
                    : m.method === "name"
                      ? "자동 연결 · 이름 일치"
                      : m.manualReason}
              </p>
              {m.suggestedId && m.suggestedId !== selected ? (
                <div className="space-y-1">
                  <p className="text-xs text-text-dim">
                    원본의 한글 이름과 일치: {m.suggestedName}
                  </p>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => select(m.sheetName, m.suggestedId!)}
                  >
                    {m.suggestedName} 강사 연결
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
