"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { GripVertical, Trash2, X } from "@/components/icons/eywa-icon-compat";
import type { ClassOption, GroupDraft } from "@/features/timetable/lib/group-assign";

/**
 * 통합뷰 '그룹 설정' 드래그 보드의 조각들 — 반 칩 / 드롭 칸 / 줄(섹션) 행.
 * 상태 전이는 전부 [group-assign.ts](src/features/timetable/lib/group-assign.ts)(순수)에 있고,
 * 여기는 **드래그 배선과 모양**만 담당한다. 조립은 group-settings-board.tsx.
 *
 * ⚠️ 드래그가 안 되는 상황(좁은 창·마우스 없음·손떨림)에도 같은 일을 할 수 있어야 한다 →
 * 칩엔 '빼기(×)', 줄 헤더엔 '반 넣기' 셀렉트를 **폴백 경로**로 둔다(드래그는 빠른 길일 뿐).
 */

// dnd-kit 변환 → 인라인 style. @dnd-kit/utilities는 설치돼 있지 않으므로(전이 의존) 직접 만든다.
type Xf = { x: number; y: number } | null;
const dragStyle = (transform: Xf, transition: string | undefined) => ({
  transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  transition,
});

/** 반 칩 — 끌어서 다른 줄로. 칩 몸통이 손잡이, ×는 미배정으로 빼기(드래그 없이도 되는 길). */
export function ClassChip({
  classId,
  className,
  containerId,
  onUnassign,
}: {
  classId: string;
  className: string;
  containerId: string;
  onUnassign?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `cls:${classId}`,
    data: { type: "class", classId, containerId },
  });
  return (
    <span
      ref={setNodeRef}
      style={dragStyle(transform, transition)}
      className={`border-line bg-card inline-flex shrink-0 items-center rounded-full border text-[12px] ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-foreground cursor-grab touch-none py-1 pl-2.5 font-medium select-none active:cursor-grabbing"
        title={`${className} — 끌어서 다른 줄로`}
      >
        {className}
      </button>
      {onUnassign ? (
        <button
          type="button"
          onClick={onUnassign}
          aria-label={`${className} 미배정으로`}
          title="미배정으로 빼기"
          className="text-text-faint hover:text-danger px-1.5 py-1"
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="pr-2.5" />
      )}
    </span>
  );
}

/**
 * 칩을 놓는 칸 — 비어 있을 때도 높이를 유지해야 "여기 놓으면 된다"가 보인다.
 * 칩이 여러 줄로 감기므로 정렬 전략은 `rectSortingStrategy`(행 리스트 전략은 감긴 칩 위치를 못 맞춘다).
 */
export function DropBox({
  containerId,
  ids,
  emptyHint,
  capped,
  children,
}: {
  containerId: string;
  /** 이 칸의 칩 id 목록(정렬 컨텍스트) — 순서가 곧 통합뷰 열 순서. */
  ids: string[];
  emptyHint: string;
  /**
   * 높이를 제한하고 칸 **안에서** 스크롤(미배정 칸용). 반이 40개쯤이면 미배정 칸만으로 화면이 다 차서
   * 목적지인 '줄'이 아래로 밀려나 드래그 자체가 불가능해진다(2026-07-30 실측 37개 = 줄이 접힘).
   * ⚠️ 스크롤은 **드롭 대상 자신에게** 걸어야 한다 — 바깥 래퍼에 걸면 droppable 사각형이 안 보이는
   * 영역까지 커져서, 아래 줄 위에 있는데도 미배정 칸으로 판정된다.
   */
  capped?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${containerId}`, data: { type: "box", containerId } });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[38px] flex-wrap content-start items-start gap-1.5 rounded-lg border border-dashed p-1.5 transition ${
        capped ? "max-h-[132px] overflow-y-auto" : ""
      } ${isOver ? "border-primary bg-primary-soft/50" : "border-line"}`}
    >
      <SortableContext items={ids.map((id) => `cls:${id}`)} strategy={rectSortingStrategy}>
        {ids.length === 0 ? <span className="text-text-faint px-1 py-1 text-[11px]">{emptyHint}</span> : children}
      </SortableContext>
    </div>
  );
}

/** 줄(섹션) 하나 — 손잡이로 순서 바꾸기, 제목 입력, 반 칩 드롭 칸. 위에서부터 통합뷰 섹션 순서. */
export function GroupRow({
  group,
  index,
  visible,
  nameOf,
  unassigned,
  onTitle,
  onDelete,
  onAdd,
  onUnassign,
}: {
  group: GroupDraft;
  index: number;
  /** 이 줄에서 이 주에 실제 있는 반 id(저장된 열 순서) — 칩으로 그릴 목록. */
  visible: string[];
  nameOf: (classId: string) => string;
  /** 미배정 반 — 드래그 없이 넣는 폴백 셀렉트용. 없으면 셀렉트를 숨긴다. */
  unassigned: ClassOption[];
  onTitle: (title: string) => void;
  onDelete: () => void;
  onAdd: (classId: string) => void;
  onUnassign: (classId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `grp:${group.id}`,
    data: { type: "group", groupId: group.id },
  });
  return (
    <li
      ref={setNodeRef}
      style={dragStyle(transform, transition)}
      className={`border-line bg-bg-soft/40 rounded-xl border p-2 ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`${group.title || `${index + 1}번째 줄`} 순서 바꾸기`}
          title="끌어서 줄 순서 바꾸기"
          className="text-text-faint hover:text-foreground cursor-grab touch-none px-0.5 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <span className="text-text-faint num w-4 text-center text-[11px]">{index + 1}</span>
        <input
          value={group.title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="줄 이름 (예: 초등부)"
          className="border-line focus:border-primary bg-card min-w-0 flex-1 rounded-lg border px-2 py-1 text-[13px] outline-none"
          aria-label={`${index + 1}번째 줄 이름`}
        />
        <span className="text-text-faint num shrink-0 text-[11px]">{visible.length}개</span>
        {unassigned.length > 0 ? (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAdd(e.target.value);
            }}
            className="border-line focus:border-primary bg-card shrink-0 rounded-lg border px-1.5 py-1 text-[11px] outline-none"
            aria-label={`${index + 1}번째 줄에 반 넣기`}
            title="드래그 없이 반 넣기"
          >
            <option value="">+ 반</option>
            {unassigned.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.className}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" onClick={onDelete} aria-label="줄 삭제" className="text-text-dim hover:text-danger px-0.5">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <DropBox containerId={group.id} ids={visible} emptyHint="여기로 반을 끌어다 놓으세요">
        {visible.map((id) => (
          <ClassChip
            key={id}
            classId={id}
            className={nameOf(id)}
            containerId={group.id}
            onUnassign={() => onUnassign(id)}
          />
        ))}
      </DropBox>
    </li>
  );
}
