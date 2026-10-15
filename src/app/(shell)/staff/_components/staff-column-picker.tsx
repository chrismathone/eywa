"use client";

import { useId, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronDown, ChevronUp, Check, GripVertical, X } from "@/components/icons/aywa-icon-compat";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { LABEL_OF, moveColumn, normalizeOrder, STAFF_COLUMNS, type StaffColumnKey } from "@/features/staff/list/columns";
import { useStaffViewPrefs } from "./staff-view-prefs";

/**
 * 열 고르기 — 무엇을 어떤 순서로 볼지(원장 지시 2026-07-31 "입맛대로 볼 수 있게").
 * 진실은 **계정**(`ui_prefs.staff.columnOrder/columnHidden`, 원장 2026-08-04 "뷰 세팅은 계정 귀속") — 원장과 회계가 보고 싶은
 * 열이 같을 이유가 없고, 같은 사람은 어느 PC에서나 같아야 한다. 값·저장은 `StaffViewPrefsProvider`(즉시 반영 + 단일 큐 저장).
 *
 * 순서는 **행을 잡고 끌어서** 바꾼다(원장 2026-10-06 "클릭으로 찝어서 순서 교체") — ↑↓ 버튼도 그대로 둔다.
 * 4px 넘게 끌어야 드래그라, 제자리 클릭은 여전히 표시 켜고 끄기다(landing-order-rows와 같은 센서 규약).
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
  const uid = useId(); // SSR에서 DndContext id가 필요하다([[#51]])
  // 포인터만 — 키보드 센서를 행에 걸면 안의 체크 버튼에서 누른 Space·Enter가 버블돼 드래그로 잡힌다.
  // 키보드 사용자는 ↑↓ 버튼으로 옮긴다.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as StaffColumnKey);
    const to = order.indexOf(over.id as StaffColumnKey);
    if (from < 0 || to < 0) return;
    setColumns(arrayMove(order, from, to), hidden);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        // 치수는 control-scale(높이 = 라벨 + 4) — 세로 패딩으로 높이를 만들지 않는다(v5).
        className={`${CONTROL_H} ${CONTROL_LABEL} border-line bg-card text-text-dim hover:border-primary/40 hover:text-primary inline-flex items-center gap-1 rounded-lg border px-2.5 transition`}
        aria-expanded={open}
      >
        열 {shownCount}/{STAFF_COLUMNS.length}
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </Popover.Trigger>

      {open ? (
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-50">
          <Popover.Popup className="border-line bg-card shadow-modal w-60 max-w-(--available-width) rounded-xl border p-2 outline-none">
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
            <DndContext id={uid} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {order.map((k, i) => {
                const visible = !off.has(k);
                return (
                  <SortableRow key={k} id={k}>
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
                  </SortableRow>
                );
              })}
            </ul>
            </SortableContext>
            </DndContext>
            <div className="mt-1.5 flex justify-end px-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <X className="size-3" /> 닫기
              </button>
            </div>
          </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      ) : null}
    </Popover.Root>
  );
}

/**
 * 끌 수 있는 한 줄 — 행 전체가 손잡이다(어디를 잡아도 끌린다). 맨 왼쪽 점 손잡이는 "끌 수 있다"는 표시.
 * touch-none이 없으면 터치에서 스크롤이 드래그를 삼킨다(dnd-kit 요구).
 */
function SortableRow({ id, children }: { id: StaffColumnKey; children: ReactNode }) {
  // attributes(role=button·tabIndex)는 안 붙인다 — 행 안에 이미 버튼이 셋이라 중첩 상호작용이 된다.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      // 세로 목록이라 y만 반영(가로 흔들림 제거).
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={`hover:bg-bg-soft flex cursor-grab touch-none items-center gap-1 rounded-md px-1 py-0.5 active:cursor-grabbing ${
        isDragging ? "bg-bg-soft relative z-10 shadow-sm" : ""
      }`}
      {...listeners}
    >
      <GripVertical className="text-text-faint size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </li>
  );
}
