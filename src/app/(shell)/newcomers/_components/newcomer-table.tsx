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
  daysBetween,
  daysLeftOf,
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
 * 🔴 칸은 **체크박스가 아니라 상태**다: 완료 / 지연 / 오늘·임박 / 예정(D-n) / 기한 없음 / 기준일 전.
 *    체크박스만 두면 "아직 할 때가 아닌 것"과 "놓친 것"이 같아 보인다.
 * 🔴 **칸을 통째로 칠한다**(원장 2026-09-09 *"체크를 하게되면 셀을 전체 색칠해버려서 마치 프로그레스바처럼
 *    보이도록 해"*) — 한 행을 가로로 훑으면 왼쪽부터 채워진 띠가 되어 "어디까지 왔나"가 한눈에 보인다.
 *    그래서 항목 열은 **폭이 전부 같아야 한다**(칸마다 폭이 다르면 띠가 울퉁불퉁해 진도로 안 읽힌다).
 * 🔴 낙관 반영 후 실패하면 **되돌린다** — 저장 안 된 체크가 화면에만 남으면 그게 가장 나쁜 거짓말이다.
 */

/**
 * 열 폭(%) — `table-fixed`라 내용이 폭을 못 흔든다(원장 *"모든 열너비 통일시킬 수 있으면 통일"*).
 * 🔴 항목 열은 **남는 폭을 정확히 n등분**한다 — 값을 하나씩 적어 두면 항목이 늘 때 합이 100을 벗어난다.
 */
const NAME_W = 15;
const ENROLLED_W = 8;
const FIRST_CLASS_W = 9;
const ITEM_W = (100 - NAME_W - ENROLLED_W - FIRST_CLASS_W) / ONBOARDING_ITEMS.length;

/**
 * 상태별 칸 모양 — **칸 전체**를 칠한다.
 * ⚠️ 색은 의미색 캐논 그대로(완료=초록 / 지연=빨강 / 임박=앰버 / 그 밖=무채색).
 *    `waived`(기능 시작 전 기한)는 **경고가 아니다** — 옅은 회색으로 "셀 것 없음"을 말한다.
 */
const STATUS_STYLE: Record<OnboardingItemStatus, { fill: string; label: string }> = {
  done: { fill: "bg-green text-white", label: "완료" },
  overdue: { fill: "bg-danger text-white", label: "지연" },
  due: { fill: "bg-amber text-white", label: "오늘·임박" },
  upcoming: { fill: "bg-bg-soft/50 text-green", label: "예정" },
  pending: { fill: "bg-bg-soft/30 text-text-faint", label: "기한 없음(첫 수업일 미정)" },
  waived: { fill: "bg-bg-soft/30 text-text-faint", label: "기능 시작 전 기한 — 세지 않습니다" },
};

/** `26.10.01` — 연도까지(원장 2026-09-09 *"첫 수업 열은 연도까지 붙여줘 26.10.01 이렇게"*). */
function shortDate(ymd: string): string {
  return `${ymd.slice(2, 4)}.${ymd.slice(5, 7)}.${ymd.slice(8, 10)}`;
}

function Cell({
  row,
  itemKey,
  status,
  due,
  daysLeft,
  canWrite,
  onToggle,
  busy,
}: {
  row: NewcomerRow;
  itemKey: string;
  status: OnboardingItemStatus;
  due: string | null;
  daysLeft: number | null;
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
    // 🔴 패딩 없는 칸 — 칠이 칸을 꽉 채워야 가로로 이어진 띠(진도)로 읽힌다.
    <td className="p-0">
      <button
        type="button"
        disabled={!canWrite || busy}
        onClick={onToggle}
        title={title}
        aria-label={`${row.name} — ${title}`}
        aria-pressed={status === "done"}
        className={`num flex h-7 w-full items-center justify-center text-xs font-bold transition disabled:cursor-default ${meta.fill} ${
          canWrite && !busy ? "hover:brightness-95" : ""
        }`}
      >
        {status === "done" ? (
          <EyIcon name="check" size={14} />
        ) : status === "upcoming" && daysLeft !== null ? (
          // 🔴 남은 날을 **초록**으로 적는다(원장 *"옆에 초록색으로 D-n 처럼 몇일 남았다고"*) —
          //    흐린 칸만으로는 "아직 안 왔다"까지만 알고 "언제 오나"를 모른다.
          <span>D-{daysLeft}</span>
        ) : null}
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
    // 열이 10개라 좁은 창에선 넘친다 — 넘치는 영역의 기본 인터랙션은 **잡고 끌기**(앱 규약).
    // ⚠️ 5px 넘게 끌어야 팬이라 제자리 클릭(체크)은 그대로 산다([[#97]]).
    <DragScrollArea>
      <table className="w-full min-w-[52rem] table-fixed border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
        <colgroup>
          <col style={{ width: `${NAME_W}%` }} />
          <col style={{ width: `${ENROLLED_W}%` }} />
          <col style={{ width: `${FIRST_CLASS_W}%` }} />
          {ONBOARDING_ITEMS.map((item) => (
            <col key={item.key} style={{ width: `${ITEM_W}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-line text-text-dim border-b text-center text-xs font-bold">
            <th className="px-2 py-2 text-left">학생</th>
            <th className="px-1 py-2">등록일</th>
            <th className="px-1 py-2">첫 수업</th>
            {ONBOARDING_ITEMS.map((item) => (
              // 폭이 고정이라 긴 이름은 칸 안에서 접는다 — `nowrap`이면 머리가 옆 칸을 밀고 나간다.
              <th key={item.key} className="px-1 py-2 leading-tight break-keep" title={item.label}>
                {item.shortLabel}
                {item.optional ? <span className="text-text-faint font-medium"> (선택)</span> : null}
              </th>
            ))}
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
                <td className="px-2 py-1">
                  {/* 이름 열이 좁아졌다(원장 2026-09-09) — 넘치면 자르고 전체 이름은 title에. */}
                  <WindowLink
                    href={`/students/${row.studentId}`}
                    title={`${row.name} ${schoolGradeLabel(row.school, row.grade) || ""}`.trim()}
                    className="flex min-w-0 items-baseline gap-1.5 hover:underline"
                  >
                    <span className="text-foreground shrink-0 font-bold">{row.name}</span>
                    <span className="text-text-faint min-w-0 truncate text-xs">
                      {schoolGradeLabel(row.school, row.grade) || "—"}
                    </span>
                  </WindowLink>
                </td>
                {/* 🔴 경과일은 **첫 수업일 기준으로만** 센다(원장 2026-09-09 *"등록일에는 +n 해줄 필요
                    없을것 같고, 첫 수업일 기준으로만"*) — 체크 항목 넷이 첫 수업일에 매달려 있어서
                    "며칠 됐나"가 실제로 뜻을 갖는 자리도 그쪽이다. */}
                <td className="text-text-dim num px-1 py-1 text-center whitespace-nowrap">
                  {row.enrolledOn.slice(5).replace("-", "/")}
                </td>
                <td className="text-text-dim num px-1 py-1 text-center whitespace-nowrap">
                  {row.firstClassOn ? (
                    <>
                      {shortDate(row.firstClassOn)}
                      {(() => {
                        const n = daysBetween(row.firstClassOn, today);
                        // 아직 안 온 첫 수업은 `D-n`(초록) — 지난 것은 `+n`(옅게). 같은 값이지만
                        // "며칠 남았다"와 "며칠 됐다"는 다른 사실이라 표기를 가른다.
                        return n < 0 ? (
                          <span className="ml-1 text-xs font-bold text-green">D{n}</span>
                        ) : (
                          <span className="text-text-faint ml-1 text-xs">+{n}</span>
                        );
                      })()}
                    </>
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
                      daysLeft={daysLeftOf(item, anchors, today)}
                      canWrite={canWrite}
                      busy={busyKey === `${row.studentId}|${item.key}`}
                      onToggle={() => toggle(row, item.key, status === "done")}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
