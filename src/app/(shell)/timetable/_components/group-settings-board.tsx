"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "@/components/icons/eywa-icon-compat";
import {
  POOL_ID,
  moveClass,
  offWeekCount,
  reorderGroups,
  unassignedOf,
  visibleIdsOf,
  type ClassOption,
  type GroupDraft,
} from "@/features/timetable/lib/group-assign";
import { ClassChip, DropBox, GroupRow } from "./group-settings-items";

/**
 * 통합뷰 '그룹 설정' 드래그 보드 — 반을 끌어서 줄(섹션)에 놓고, 줄도 끌어서 순서를 바꾼다.
 *
 * 왜 드롭다운(구 UI)에서 드래그로 바꿨나: 반이 30개쯤 되면 "이 반은 어느 줄?"을 셀렉트로 하나씩
 * 고르는 동안 **전체 배치가 안 보인다**(원장 2026-07-30 "지금 그룹 설정은 너무 어려움").
 * 보드는 지금 배치가 통합뷰 모양 그대로 보이고, 옮기는 동작이 곧 결과다.
 * 드래그가 어려운 상황을 위한 폴백(줄 헤더 '+반' 셀렉트·칩 '×')은 그대로 둔다 — 드래그는 빠른 길일 뿐.
 */
export function GroupSettingsBoard({
  classes,
  groups,
  onChange,
  onAddGroup,
  poolNote,
}: {
  /** 이 과목·이 주 시간표에 실제 있는 반(가나다) — 칩으로 그릴 대상. */
  classes: ClassOption[];
  groups: GroupDraft[];
  onChange: (next: GroupDraft[]) => void;
  onAddGroup: () => void;
  /** 미배정 칸 아래 안내 — 통합뷰에서 그 반들이 어떻게 되는지(줄로 표시 / 숨김)를 부모가 정한다. */
  poolNote: ReactNode;
}) {
  // 5px 임계값 — 이거 없으면 제목 입력·삭제 버튼 클릭이 드래그로 먹힌다.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<{ kind: "class" | "group"; label: string } | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map(classes.map((c) => [c.classId, c.className]));
    return (id: string) => m.get(id) ?? id;
  }, [classes]);
  const unassigned = useMemo(() => unassignedOf(classes, groups), [classes, groups]);
  const offWeek = useMemo(() => offWeekCount(groups, classes), [groups, classes]);

  function onDragStart({ active }: DragStartEvent) {
    const d = active.data.current;
    if (d?.type === "class") setDragging({ kind: "class", label: nameOf(String(d.classId)) });
    else if (d?.type === "group")
      setDragging({ kind: "group", label: groups.find((g) => g.id === d.groupId)?.title || "이름 없는 줄" });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const a = active.data.current;
    const o = over?.data.current;
    if (!a || !o) return; // 칸 밖에서 놓음 = 무동작(엉뚱한 줄로 튀지 않게)
    if (a.type === "group") {
      if (o.type === "group") onChange(reorderGroups(groups, String(a.groupId), String(o.groupId)));
      return;
    }
    if (a.type !== "class") return;
    // 칩 위 = 그 칩 앞자리 / 칸의 빈 곳 = 맨 뒤. 순서가 곧 통합뷰 열 순서다.
    if (o.type === "class") onChange(moveClass(groups, String(a.classId), String(o.containerId), String(o.classId)));
    else if (o.type === "box") onChange(moveClass(groups, String(a.classId), String(o.containerId), null));
  }

  return (
    <DndContext
      id="group-settings-dnd"
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <section>
        <h3 className="text-foreground mb-1.5 text-[13px] font-semibold">
          미배정 반 <span className="text-text-faint num text-[11px]">{unassigned.length}개</span>
        </h3>
        <DropBox
          containerId={POOL_ID}
          ids={unassigned.map((c) => c.classId)}
          emptyHint="모든 반이 줄에 배정됐습니다"
          capped
        >
          {unassigned.map((c) => (
            <ClassChip key={c.classId} classId={c.classId} className={c.className} containerId={POOL_ID} />
          ))}
        </DropBox>
        <p className="text-text-faint mt-1 text-[11px]">{poolNote}</p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-foreground text-[13px] font-semibold">
            줄(섹션) <span className="text-text-faint text-[11px]">위에서부터 통합뷰 순서</span>
          </h3>
          <button
            type="button"
            onClick={onAddGroup}
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px]"
          >
            <Plus className="size-3" />줄 추가
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="text-text-faint border-line rounded-lg border border-dashed px-3 py-4 text-center text-[12px]">
            아직 줄이 없습니다 — ‘줄 추가’로 만들고 위 반을 끌어다 놓으세요.
          </p>
        ) : (
          <SortableContext items={groups.map((g) => `grp:${g.id}`)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {groups.map((g, i) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  index={i}
                  visible={visibleIdsOf(g, classes)}
                  nameOf={nameOf}
                  unassigned={unassigned}
                  onTitle={(title) => onChange(groups.map((x) => (x.id === g.id ? { ...x, title } : x)))}
                  onDelete={() => onChange(groups.filter((x) => x.id !== g.id))}
                  onAdd={(classId) => onChange(moveClass(groups, classId, g.id, null))}
                  onUnassign={(classId) => onChange(moveClass(groups, classId, POOL_ID, null))}
                />
              ))}
            </ul>
          </SortableContext>
        )}
        {/* 칩이 없는 배정도 저장 때 남는다는 사실을 밝힌다 — 조용히 지우면 다른 주 배치가 무너진다. */}
        {offWeek > 0 ? (
          <p className="text-text-faint mt-1.5 text-[11px]">
            이 주 시간표에 없는 반 {offWeek}개의 배정도 그대로 보존됩니다(다른 주에서 보입니다).
          </p>
        ) : null}
      </section>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <span className="border-primary bg-card text-foreground pointer-events-none inline-flex cursor-grabbing items-center rounded-full border px-2.5 py-1 text-[12px] font-medium shadow-lg">
            {dragging.label}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * 한 보드에 성격이 다른 드래그가 둘 있다(줄 순서 / 반 칩). 후보를 안 걸러내면 줄을 끄는데 반 칩이
 * `over`로 잡혀 **아무 일도 안 일어난다** → 끄는 것과 같은 종류만 남긴다.
 * 포인터 드래그는 `pointerWithin`(칸 밖에서 놓으면 무동작 = 엉뚱한 줄로 안 튄다),
 * 키보드 드래그는 포인터 좌표가 없으므로 `closestCenter` 폴백(없으면 키보드로 옮길 수 없다).
 */
const collision: CollisionDetection = (args) => {
  const kind = args.active.data.current?.type;
  const droppableContainers = args.droppableContainers.filter((c) => {
    const t = c.data.current?.type;
    return kind === "group" ? t === "group" : t === "class" || t === "box";
  });
  const scoped = { ...args, droppableContainers };
  return args.pointerCoordinates ? pointerWithin(scoped) : closestCenter(scoped);
};
