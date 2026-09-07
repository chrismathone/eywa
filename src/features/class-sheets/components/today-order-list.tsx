"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical } from "@/components/icons/eywa-icon-compat";
import { toast } from "sonner";
import { setMyEcsTodayOrder } from "@/features/class-sheets/server/actions";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * ECS **오늘 면 반 순서 바꾸기**(원장 2026-09-05 *"개인별 커스터마이징 가능하게 드래그드랍으로"*).
 *
 * 🔴 **카드 내용은 서버가 그린 그대로**를 받아 자리만 옮긴다(`node`). 이 컴포넌트가 시트를 다시 그리면
 *    편집기·저널·presence가 통째로 재마운트돼 **입력 중이던 값이 날아간다** — 순서만 바꾸는 껍데기다.
 *    `key`가 반 id라 React도 재마운트 없이 자리만 옮긴다.
 * 🔴 손잡이(그립)로만 끈다 — 카드 전체를 드래그 대상으로 두면 표 안에서 값을 끌어 고치는 동작
 *    (드래그-팬·셀 선택)을 통째로 삼킨다([[#97]]와 같은 결).
 * ⚠️ 저장은 **낙관적**이다: 화면은 즉시 바뀌고 실패하면 되돌린 뒤 이유를 말한다. 순서는 취향이라
 *    저장 왕복을 기다리게 하면 끌 때마다 화면이 멎는다.
 * ⚠️ 저장하는 값은 **오늘 보이는 반의 순서**뿐이고, 서버가 옛 저장분과 합친다(`mergeTodayOrder`) —
 *    다른 요일 반의 순서를 오늘 화면이 지우지 않는다.
 */
export function TodayOrderList({ items }: { items: { id: string; label: string; node: ReactNode }[] }) {
  const t = useSheetT();
  const [ids, setIds] = useState<string[]>(() => items.map((i) => i.id));
  const [, startSave] = useTransition();
  // 한 화면에 이 목록은 하나지만, SSR/CSR 같은 id가 필요해 useId(하드코딩은 hydration 불일치).
  const uid = useId();
  const sensors = useSensors(
    // 4px 전엔 클릭 — 손잡이를 살짝 눌러도 순서가 안 흔들린다(설정 편집기와 같은 값).
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  // 서버가 새 반을 보내왔는데 state가 옛 목록이면 그 반이 화면에서 빠진다 → 목록에 없는 id는 뒤에 붙인다.
  const shown = [...ids.filter((id) => byId.has(id)), ...items.map((i) => i.id).filter((id) => !ids.includes(id))];

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = shown.indexOf(String(active.id));
    const to = shown.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const before = shown;
    const next = arrayMove(shown, from, to);
    setIds(next);
    startSave(async () => {
      const res = await setMyEcsTodayOrder(next);
      if (!res.ok) {
        setIds(before); // 되돌린다 — 저장 안 된 순서를 남기면 새로고침에 조용히 사라진다.
        toast.error(res.error ?? t("today.order.saveFail"));
      }
    });
  };

  return (
    <DndContext id={uid} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={shown} strategy={verticalListSortingStrategy}>
        <div className="space-y-6">
          {shown.map((id) => {
            const it = byId.get(id);
            if (!it) return null;
            return <SortableClass key={id} id={id} label={it.label} node={it.node} />;
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableClass({ id, label, node }: { id: string; label: string; node: ReactNode }) {
  const t = useSheetT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <section
      ref={setNodeRef}
      // 세로 목록이라 y만 반영(가로 흔들림 제거). @dnd-kit/utilities는 미설치라 transform은 직접 만든다.
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={`relative space-y-2 ${isDragging ? "z-10 opacity-90" : ""}`}
    >
      {/* 🔴 손잡이는 카드 **오른쪽 위 빈자리**에 겹쳐 둔다 — 줄을 따로 만들면 반마다 한 줄씩 늘어난다
          (원장 2026-08-18에 수업명 줄을 카드 안으로 내려 아낀 그 줄이다). */}
      <button
        type="button"
        aria-label={`${label} ${t("today.order.handleAria")}`}
        title={t("today.order.handleTitle")}
        // touch-none이 없으면 터치에서 스크롤이 드래그를 삼킨다(dnd-kit 요구).
        className="text-text-faint hover:text-foreground absolute top-2.5 right-2.5 z-10 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      {node}
    </section>
  );
}
