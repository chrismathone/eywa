"use client";

import { useSheetFeedback } from "@/features/teacher-view/lang-context";
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
import { GripVertical } from "@/components/icons/aywa-icon-compat";
import { toast } from "sonner";
import { setMyEcsLandingOrder } from "@/features/class-sheets/server/actions";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * ECS 주간 랜딩 — **묶음 안에서 반 순서 바꾸기**(원장 2026-09-05 *"요것도 사용자가 임의로 순서 바꿀 수
 * 있게 드래그기능넣어줘"*). 오늘 면 순서(`today-order-list.tsx`)와 **같은 규약·다른 저장 키**다.
 *
 * 🔴 **묶음을 넘나들 수 없다** — `SortableContext`를 묶음마다 하나씩 두어 구조로 막는다.
 *    담임/부담임(그리고 EiE/인재원)은 **취향이 아니라 사실**이라, 부담임 반을 담임 칸으로 끌면 화면이
 *    거짓말을 한다. 순서는 사람이 정하고 소속은 데이터가 정한다.
 * 🔴 저장 키가 오늘 면과 **다르다**(`landingOrder` vs `todayOrder`) — 두 화면은 같은 반을 다른 축으로
 *    세운다(오늘=그날 수업 있는 반·시각순 / 랜딩=그 주 전체·묶음 안 이름순). 한 키를 공유하면 한쪽에서
 *    끈 것이 다른 쪽 순서를 뒤집는다.
 * ⚠️ 행 내용(`node`)은 서버가 그린 그대로 받는다 — 여기선 `<li>` 껍데기와 손잡이만 만든다.
 */
export function LandingOrderRows({
  items,
  canReorder = true,
}: {
  items: { id: string; node: ReactNode }[];
  /**
   * 🔴 false면 **드래그 장치를 아예 안 만든다**('다른 강사 뷰'는 열람 전용 — 원장 2026-09-05).
   *    손잡이만 감추고 DndContext를 남기면 키보드 센서로는 여전히 옮겨져 저장까지 간다.
   */
  canReorder?: boolean;
}) {
  const feedback = useSheetFeedback();
  const t = useSheetT();
  const [ids, setIds] = useState<string[]>(() => items.map((i) => i.id));
  const [, startSave] = useTransition();
  const uid = useId();
  const sensors = useSensors(
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
      const res = await setMyEcsLandingOrder(next);
      if (!res.ok) {
        setIds(before);
        toast.error(feedback(res.error ?? t("today.order.saveFail")));
      }
    });
  };

  if (!canReorder) {
    return (
      <ul>
        {items.map((it) => (
          <li key={it.id} className="border-line-faint flex items-center border-b">
            {it.node}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <DndContext id={uid} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={shown} strategy={verticalListSortingStrategy}>
        <ul>
          {shown.map((id) => {
            const it = byId.get(id);
            if (!it) return null;
            return (
              <Row key={id} id={id}>
                {it.node}
              </Row>
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function Row({ id, children }: { id: string; children: ReactNode }) {
  const t = useSheetT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      // 세로 목록이라 y만 반영(가로 흔들림 제거). @dnd-kit/utilities는 미설치라 transform은 직접 만든다.
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={`border-line-faint flex items-center border-b ${isDragging ? "bg-bg-soft relative z-10" : ""}`}
    >
      {/* 손잡이는 행 **맨 왼쪽**(드래그 목록의 관용구). 행이 한 줄이라 세로는 안 늘어난다. */}
      <button
        type="button"
        aria-label={t("today.order.handleAria")}
        title={t("today.order.handleTitle")}
        // touch-none이 없으면 터치에서 스크롤이 드래그를 삼킨다(dnd-kit 요구).
        className="text-text-faint hover:text-foreground -ml-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      {children}
    </li>
  );
}
