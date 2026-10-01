"use client";

import { Button } from "@/components/ui/button";
import {
  acknowledgeIssues,
  groupMasterIssues,
} from "@/features/timetable/import/master/issue-groups";
import type {
  MasterIssue,
  MasterPreview,
} from "@/features/timetable/import/master/types";
import { IssueRow } from "./issue-row";

export function IssuesPanel({
  preview,
  dirty,
  pending,
  checks,
  onChecks,
}: {
  preview: MasterPreview;
  dirty: boolean;
  pending: boolean;
  checks: string[];
  onChecks: (keys: string[]) => void;
}) {
  const errors = preview.issues.filter((i) => i.severity === "error");
  const confirmations = preview.issues.filter((i) => i.severity === "confirm");
  const warnings = preview.issues.filter((i) => i.severity === "warning");
  const checked = new Set(checks);
  const confirmed = confirmations.filter((i) => checked.has(i.key)).length;
  const disabled = pending || dirty;
  const update = (items: MasterIssue[], selected: boolean) =>
    onChecks(acknowledgeIssues(items, checks, selected));
  function groups(items: MasterIssue[], kind: string) {
    return groupMasterIssues(items).map((g) => {
      const selectable = g.issues[0]?.severity === "confirm";
      const count = g.issues.filter((i) => checked.has(i.key)).length;
      return (
        <details open key={g.id} className="rounded-lg border border-line">
          <summary className="cursor-pointer bg-bg-soft px-4 py-3 text-sm font-semibold">
            {g.label} · {g.issues.length}건
            {selectable ? ` · 확인 ${count}/${g.issues.length}` : ""}
          </summary>
          {selectable ? (
            <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2">
              <Button
                variant="outline"
                disabled={disabled || count === g.issues.length}
                onClick={() => update(g.issues, true)}
                aria-label={`${g.label} 전체 확인`}
              >
                이 분류 전체 확인
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || !count}
                onClick={() => update(g.issues, false)}
                aria-label={`${g.label} 전체 해제`}
              >
                해제
              </Button>
            </div>
          ) : null}
          <ul
            aria-label={`${g.label} ${kind}`}
            className="max-h-80 overflow-y-auto px-4"
          >
            {g.issues.map((i) => (
              <IssueRow
                key={i.key}
                issue={i}
                source={preview.source}
                checked={checked.has(i.key)}
                disabled={disabled}
                onCheck={(v) => update([i], v)}
              />
            ))}
          </ul>
        </details>
      );
    });
  }
  return (
    <section aria-label="검사 결과" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">
          {dirty
            ? "입력 변경 · 다시 검사 필요"
            : errors.length
              ? `적용 불가 ${errors.length}건`
              : confirmed < confirmations.length
                ? `확인 필요 ${confirmations.length - confirmed}건`
                : "적용 가능"}
        </h2>
        <span className="text-sm text-text-dim">
          수업 {preview.report.targetSchedules}개 · 연결된 반{" "}
          {new Set(preview.mappings.map((m) => m.classId).filter(Boolean)).size}
          개
        </span>
      </div>
      <p className="text-sm text-text-dim">
        적용 불가는 수정 후 다시 검사해야 합니다. 확인 항목은 내용을 검토한 뒤
        분류별 또는 전체 확인할 수 있습니다. 입력을 수정하거나 다시 검사하면
        확인 표시는 초기화됩니다.
      </p>
      {errors.length ? (
        <section aria-label="적용 불가 항목" className="space-y-3">
          <h3 className="font-semibold">적용 불가 · {errors.length}건</h3>
          {groups(errors, "적용 불가 항목")}
        </section>
      ) : null}
      {confirmations.length ? (
        <section aria-label="확인 후 적용할 항목" className="space-y-3">
          <h3 className="font-semibold">
            확인 후 적용할 항목 · {confirmed}/{confirmations.length}건 확인
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={disabled || confirmed === confirmations.length}
              onClick={() => update(confirmations, true)}
            >
              확인 항목 전체 확인
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || !confirmed}
              onClick={() => update(confirmations, false)}
            >
              확인 항목 전체 해제
            </Button>
          </div>
          {groups(confirmations, "확인 항목")}
        </section>
      ) : null}
      {warnings.length ? (
        <details>
          <summary className="cursor-pointer text-sm">
            참고·기존 수강 유지 {warnings.length}건
          </summary>
          <div className="mt-3 space-y-3">{groups(warnings, "참고 항목")}</div>
        </details>
      ) : null}
    </section>
  );
}
