"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { EyIcon } from "@/components/icons/eywa-icons";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { setOnboardingCheck } from "@/features/newcomers/server/actions";
import {
  ONBOARDING_ITEMS,
  dueDateOf,
  progressOf,
  statusOf,
  type NewcomerAnchors,
  type OnboardingItemStatus,
} from "@/features/newcomers/onboarding-items";
import type { NewcomerRow } from "@/features/newcomers/server/queries";

/**
 * 신규생 체크 표 — 학생 한 줄 × 항목 7칸.
 *
 * 🔴 칸은 **체크박스가 아니라 상태**다: 완료(체크) / 지연(빨강) / 오늘·임박(앰버) / 예정(옅음) /
 *    기한 없음(첫 수업일 미정 — 회색 점). 체크박스만 두면 "아직 할 때가 아닌 것"과 "놓친 것"이 같아 보인다.
 * 🔴 낙관 반영 후 실패하면 **되돌린다** — 저장 안 된 체크가 화면에만 남으면 그게 가장 나쁜 거짓말이다.
 * ⚠️ 표 본문은 좌측 정렬(데이터 표 규약)이고 체크 칸만 가운데다(칩 열 규약).
 */

const STATUS_STYLE: Record<OnboardingItemStatus, { box: string; label: string }> = {
  done: { box: "bg-green text-white border-green", label: "완료" },
  overdue: { box: "border-danger text-danger bg-danger-soft", label: "지연" },
  due: { box: "border-amber text-amber bg-amber-soft", label: "오늘·임박" },
  upcoming: { box: "border-line text-text-faint", label: "예정" },
  pending: { box: "border-dashed border-line text-text-faint", label: "기한 없음(첫 수업일 미정)" },
};

function Cell({
  row,
  itemKey,
  status,
  due,
  canWrite,
  onToggle,
  busy,
}: {
  row: NewcomerRow;
  itemKey: string;
  status: OnboardingItemStatus;
  due: string | null;
  canWrite: boolean;
  onToggle: () => void;
  busy: boolean;
}) {
  const meta = STATUS_STYLE[status];
  const doneOn = row.checks[itemKey];
  const title = [
    meta.label,
    due ? `기한 ${due}` : "기한 없음 — 첫 수업일이 정해지면 계산됩니다",
    doneOn ? `완료 ${doneOn}` : null,
    canWrite ? (status === "done" ? "눌러서 해제" : "눌러서 완료") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <td className="px-2 py-1.5 text-center">
      <button
        type="button"
        disabled={!canWrite || busy}
        onClick={onToggle}
        title={title}
        aria-label={`${row.name} — ${title}`}
        aria-pressed={status === "done"}
        className={`inline-flex size-6 items-center justify-center rounded-md border transition disabled:cursor-default ${meta.box} ${
          canWrite && !busy ? "hover:opacity-80" : ""
        }`}
      >
        {status === "done" ? <EyIcon name="check" size={14} /> : null}
      </button>
    </td>
  );
}

export function NewcomerTable({
  rows,
  today,
  canWrite,
}: {
  rows: NewcomerRow[];
  today: string;
  canWrite: boolean;
}) {
  // 낙관 반영 — 서버 왕복을 기다리면 연속 체크가 답답하다. 실패하면 이 맵에서 되돌린다.
  const [patch, setPatch] = useState<Record<string, string | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <p className="text-text-faint border-line rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        이 구간에 해당하는 신규생이 없습니다.
      </p>
    );
  }

  const checksOf = (row: NewcomerRow): Record<string, string | null> => {
    const merged = { ...row.checks };
    for (const item of ONBOARDING_ITEMS) {
      const key = `${row.studentId}|${item.key}`;
      if (key in patch) merged[item.key] = patch[key] ?? null;
    }
    return merged;
  };

  const toggle = (row: NewcomerRow, itemKey: string, currentlyDone: boolean) => {
    const key = `${row.studentId}|${itemKey}`;
    const prev = checksOf(row)[itemKey] ?? null;
    setPatch((p) => ({ ...p, [key]: currentlyDone ? null : today }));
    setBusyKey(key);
    start(async () => {
      const res = await setOnboardingCheck({ studentId: row.studentId, itemKey, done: !currentlyDone });
      setBusyKey(null);
      if (!res.ok) {
        // 되돌린다 — 저장 안 된 체크가 화면에만 남으면 "했다고 알고 안 한" 것이 된다.
        setPatch((p) => ({ ...p, [key]: prev }));
        toast.error(res.error ?? "체크를 저장하지 못했습니다");
        return;
      }
      // 위 지표(지연·완료율)는 서버가 센 값이라 새로 받아야 칸과 숫자가 어긋나지 않는다.
      router.refresh();
    });
  };

  return (
    // 열이 12개라 좁은 창에선 넘친다 — 넘치는 영역의 기본 인터랙션은 **잡고 끌기**(앱 규약).
    // ⚠️ 5px 넘게 끌어야 팬이라 제자리 클릭(체크)은 그대로 산다([[#97]]).
    <DragScrollArea>
      <table className="w-full min-w-[56rem] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
        <thead>
          <tr className="border-line text-text-dim border-b text-center text-xs font-bold">
            <th className="px-2 py-2 text-left">학생</th>
            <th className="px-2 py-2 whitespace-nowrap">등록일</th>
            <th className="px-2 py-2 whitespace-nowrap">첫 수업</th>
            {ONBOARDING_ITEMS.map((item) => (
              <th key={item.key} className="px-1 py-2 whitespace-nowrap" title={item.label}>
                {item.shortLabel}
                {item.optional ? <span className="text-text-faint font-medium"> (선택)</span> : null}
              </th>
            ))}
            <th className="px-2 py-2 whitespace-nowrap">진행</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const checks = checksOf(row);
            const anchors: NewcomerAnchors = { enrolledOn: row.enrolledOn, firstClassOn: row.firstClassOn };
            const live = progressOf(anchors, checks, today);
            const overdue = live.overdue > 0;
            return (
              <tr key={row.studentId} className={`border-line-faint border-b ${overdue ? "bg-danger-soft/40" : ""}`}>
                <td className="px-2 py-1.5">
                  <WindowLink
                    href={`/students/${row.studentId}`}
                    title={row.name}
                    className="hover:underline"
                  >
                    <span className="text-foreground font-bold">{row.name}</span>
                    <span className="text-text-faint ml-1.5 text-xs">
                      {schoolGradeLabel(row.school, row.grade) || "—"}
                    </span>
                  </WindowLink>
                </td>
                <td className="text-text-dim num px-2 py-1.5 text-center whitespace-nowrap">
                  {row.enrolledOn.slice(5).replace("-", "/")}
                  <span className="text-text-faint ml-1 text-xs">+{row.elapsedDays}일</span>
                </td>
                <td className="text-text-dim num px-2 py-1.5 text-center whitespace-nowrap">
                  {row.firstClassOn ? (
                    row.firstClassOn.slice(5).replace("-", "/")
                  ) : (
                    <span className="text-text-faint" title="수강(반 배정)이 아직 없어 첫 수업일을 알 수 없습니다">
                      미정
                    </span>
                  )}
                </td>
                {ONBOARDING_ITEMS.map((item) => {
                  const status = statusOf(item, anchors, checks[item.key], today);
                  return (
                    <Cell
                      key={item.key}
                      row={row}
                      itemKey={item.key}
                      status={status}
                      due={dueDateOf(item, anchors)}
                      canWrite={canWrite}
                      busy={busyKey === `${row.studentId}|${item.key}`}
                      onToggle={() => toggle(row, item.key, status === "done")}
                    />
                  );
                })}
                <td className="px-2 py-1.5 text-center whitespace-nowrap">
                  {/* 🔴 서버가 센 `row.progress`가 아니라 **낙관 반영분으로 다시 센다** — 안 그러면 칸은
                      초록인데 숫자는 그대로라 한 행이 스스로 모순된다(같은 규칙, 같은 순수 함수). */}
                  <span className={`num text-sm font-bold ${overdue ? "text-danger" : "text-foreground"}`}>
                    {live.doneCount}/{live.dueTotal}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
