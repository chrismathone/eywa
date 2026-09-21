"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Check, X } from "@/components/icons/aywa-icon-compat";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { LABEL_OF, moveColumn, normalizeOrder, STAFF_COLUMNS, type StaffColumnKey } from "@/features/staff/columns";
import { useStaffViewPrefs } from "./staff-view-prefs";

/**
 * 열 고르기 — 무엇을 어떤 순서로 볼지(원장 지시 2026-07-31 "입맛대로 볼 수 있게").
 * 진실은 **계정**(`ui_prefs.staff.columnOrder/columnHidden`, 원장 2026-08-04 "뷰 세팅은 계정 귀속") — 원장과 회계가 보고 싶은
 * 열이 같을 이유가 없고, 같은 사람은 어느 PC에서나 같아야 한다. 값·저장은 `StaffViewPrefsProvider`(즉시 반영 + 단일 큐 저장).
 */
export function StaffColumnPicker() {
  const [open, setOpen] = useState(false);
  const { view, setColumns: setView } = useStaffViewPrefs();
  const hidden = view.columnHidden;
  const setColumns = (nextOrder: readonly StaffColumnKey[] | string[], nextHidden: string[]) =>
    setView([...nextOrder] as string[], nextHidden);
  const order = normalizeOrder(view.columnOrder);
  const off = new Set(hidden);
  const shownCount = order.filter((k) => !off.has(k)).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // 치수는 control-scale(높이 = 라벨 + 4) — 세로 패딩으로 높이를 만들지 않는다(v5).
        className={`${CONTROL_H} ${CONTROL_LABEL} border-line bg-card text-text-dim hover:border-primary/40 hover:text-primary inline-flex items-center gap-1 rounded-lg border px-2.5 transition`}
        aria-expanded={open}
      >
        열 {shownCount}/{STAFF_COLUMNS.length}
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {open ? (
        <>
          {/* 바깥 클릭으로 닫기 — 화면 전체를 덮되 팝오버보다 아래. */}
          <button
            type="button"
            aria-label="닫기"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="border-line bg-card shadow-modal absolute top-full right-0 z-50 mt-1 w-60 rounded-xl border p-2">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="micro">표시할 열 · 순서</span>
              <button
                type="button"
                onClick={() => setColumns([], [])}
                className="text-text-faint hover:text-primary text-xs underline-offset-2 hover:underline"
              >
                기본값
              </button>
            </div>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {order.map((k, i) => {
                const visible = !off.has(k);
                return (
                  <li key={k} className="hover:bg-bg-soft flex items-center gap-1 rounded-md px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setColumns(
                          order,
                          visible ? [...hidden, k] : hidden.filter((h) => h !== k),
                        )
                      }
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      aria-pressed={visible}
                    >
                      <span
                        className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                          visible ? "border-primary bg-primary text-white" : "border-line"
                        }`}
                      >
                        {visible ? <Check className="size-2.5" /> : null}
                      </span>
                      <span className={`truncate text-sm ${visible ? "text-foreground" : "text-text-faint"}`}>
                        {LABEL_OF[k]}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setColumns(moveColumn(order, k, -1), hidden)}
                      disabled={i === 0}
                      aria-label={`${LABEL_OF[k]} 위로`}
                      className="text-text-faint hover:text-primary shrink-0 disabled:opacity-25"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setColumns(moveColumn(order, k, 1), hidden)}
                      disabled={i === order.length - 1}
                      aria-label={`${LABEL_OF[k]} 아래로`}
                      className="text-text-faint hover:text-primary shrink-0 disabled:opacity-25"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1.5 flex justify-end px-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <X className="size-3" /> 닫기
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
