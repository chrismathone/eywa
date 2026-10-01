"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type {
  MasterInput,
  MasterPreview,
} from "@/features/timetable/import/master/types";
import { RosterComparison } from "./roster-comparison";

export function ClassBindings({
  preview,
  input,
  pending,
  onChange,
}: {
  preview: Pick<
    MasterPreview,
    "effectiveDate" | "mappings" | "classes" | "rosterReview"
  >;
  input: MasterInput;
  pending: boolean;
  onChange: (patch: Partial<MasterInput>) => void;
}) {
  const index = useMemo(() => {
    const currentClasses = new Map<string, string[]>();
    for (const c of preview.rosterReview.existing)
      for (const s of c.members) {
        currentClasses.set(s.studentId, [
          ...(currentClasses.get(s.studentId) ?? []),
          c.className,
        ]);
      }
    return {
      currentClasses,
      existing: new Map(
        preview.rosterReview.existing.map((c) => [c.classId, c]),
      ),
      sheet: new Map(preview.rosterReview.sheet.map((c) => [c.sheetName, c])),
    };
  }, [preview.rosterReview]);
  const select = (name: string, id: string) =>
    onChange({ classBindings: { ...input.classBindings, [name]: id } });
  return (
    <section aria-label="반 연결" id="class-bindings">
      <h2 className="text-lg font-semibold">반 연결 · 이름 변경 · 명단 비교</h2>
      <p className="mt-1 text-sm text-text-dim">
        진급한 반은 기존 반을 선택하면 같은 반의 이름만 바뀌며 수강·출결 이력이
        이어집니다. 추천은 명단을 확인한 뒤 연결해 주세요.
      </p>
      <p className="mt-1 text-xs text-text-dim">
        기존 명단 기준일: {preview.effectiveDate}. 연결을 바꾸면 다시 검사해야
        적용할 수 있습니다.
      </p>
      <div className="mt-3 space-y-3">
        {preview.mappings.map((m) => {
          const selected = input.classBindings[m.sheetName] ?? m.classId ?? "";
          const explicit = Object.hasOwn(input.classBindings, m.sheetName);
          const useSuggestion =
            !explicit && !!m.suggestedId && m.suggestedId !== m.classId;
          const comparisonId = useSuggestion ? m.suggestedId : selected;
          const existing = index.existing.get(comparisonId ?? "");
          return (
            <article
              key={m.sheetName}
              aria-label={`${m.sheetName} 반 검토`}
              className="rounded-lg border border-line p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{m.sheetName}</h3>
                  <p className="mt-1 text-xs text-text-dim">
                    {m.suggestedName
                      ? `추천 ${m.suggestedName} · ${m.evidence}`
                      : "이름 또는 학생 정보 확인"}
                  </p>
                </div>
                <div className="w-full space-y-2 sm:w-72">
                  <select
                    aria-label={`${m.sheetName} 반 연결`}
                    value={selected}
                    disabled={pending}
                    className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm disabled:opacity-60"
                    onChange={(e) => select(m.sheetName, e.target.value)}
                  >
                    <option value="">반을 선택해 주세요</option>
                    {preview.classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.name !== m.sheetName ? ` → ${m.sheetName}` : ""}
                      </option>
                    ))}
                  </select>
                  {m.suggestedId &&
                  (selected !== m.suggestedId ||
                    (!explicit && useSuggestion)) ? (
                    <Button
                      variant="outline"
                      disabled={pending}
                      className="w-full"
                      onClick={() => select(m.sheetName, m.suggestedId!)}
                    >
                      {m.suggestedName} 추천 반 연결
                    </Button>
                  ) : null}
                </div>
              </div>
              {useSuggestion ? (
                <p className="mt-2 text-xs text-text-dim">
                  아래 명단은 추천 반과의 비교입니다. 아직 연결을 확정하지
                  않았습니다.
                  {m.currentName ? ` 현재 자동 연결: ${m.currentName}.` : ""}
                </p>
              ) : null}
              <RosterComparison
                sheet={index.sheet.get(m.sheetName)}
                existing={existing}
                comparisonLabel={
                  existing
                    ? `${useSuggestion ? "추천 반" : "연결 반"} ${existing.className}`
                    : ""
                }
                currentClasses={index.currentClasses}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
