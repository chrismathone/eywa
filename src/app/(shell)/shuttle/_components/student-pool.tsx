"use client";

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { AssignableStudent } from "@/features/shuttle/server/students";

/**
 * 우열 — 배정 가능한 학생 풀(재원생). 여기서 정류장으로 끌어다 놓으면 배정되고,
 * 배정 칩을 여기로 끌어다 놓으면 해제된다(같은 곳이 원천이자 휴지통 — 방향만 반대다).
 *
 * 🔑 상한을 두지 않는다 — "상위 N 미리보기"의 배열 길이를 건수로 쓰다 34명이 영원히 "30"이던
 *    전례([[#89]])와, 정렬 편향으로 카테고리가 통째로 사라진 전례([[#84]])를 피해 **검색으로** 좁힌다.
 */
/** 한 번에 그리는 최대 인원(검색으로 좁히면 그 안에서 다시 상한). 건수 표시는 상한과 무관하다. */
const POOL_RENDER_CAP = 80;

export function StudentPool({
  students,
  assignedIds,
  canWrite,
}: {
  students: AssignableStudent[];
  assignedIds: Set<string>;
  canWrite: boolean;
}) {
  const [q, setQ] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: "pool", data: { type: "pool" } });

  const filtered = useMemo(() => {
    const key = q.replace(/\s+/g, "").toLowerCase();
    if (!key) return students;
    return students.filter((s) => s.searchKey.includes(key));
  }, [students, q]);

  /**
   * 실제로 그리는 건 상한까지만 — 항목 하나하나가 dnd-kit `useDraggable` 노드라 재원생 전원
   * (실측 336명)을 항상 마운트하면 폰에서 드래그마다 그 수만큼 측정이 돈다. 좁은 화면에서는 이 열이
   * `hidden`이어도 **React는 계속 렌더**하므로 상한이 없으면 안 보이는 곳에서 비용이 난다.
   * ⚠️ 위 건수 표시는 `filtered.length`(참값) 그대로 둔다 — 잘린 배열 길이를 건수로 쓰지 말 것([[#89]]).
   */
  const shown = useMemo(() => filtered.slice(0, POOL_RENDER_CAP), [filtered]);

  return (
    <div
      ref={setNodeRef}
      className={`bg-card flex min-h-0 flex-col gap-2 rounded-2xl p-2.5 shadow-[var(--shadow-card)] transition-colors ${
        isOver ? "ring-danger ring-2" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-text text-[13.5px] font-bold">학생</h3>
        <span className="text-text-faint text-[11.5px]">
          <span className="num">{filtered.length}</span>명
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름·학교 검색"
        className="border-line focus:border-primary h-11 rounded-lg border px-2.5 text-base outline-none sm:h-8 sm:text-[12.5px]"
      />

      {isOver && (
        <p className="text-danger text-center text-[11.5px] font-bold">여기 놓으면 배정 해제</p>
      )}

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {shown.map((s) => (
          <PoolItem key={s.id} student={s} assigned={assignedIds.has(s.id)} canWrite={canWrite} />
        ))}
        {filtered.length === 0 && (
          <li className="text-text-faint px-1 py-2 text-[12px]">찾는 학생이 없습니다</li>
        )}
        {filtered.length > shown.length && (
          // ⚠️ 위의 건수(filtered.length)는 **참값**을 유지한다 — 잘린 배열 길이를 건수로 쓰면
          //    학생이 늘어도 숫자가 상한에 붙어 안 변한다([[#89]]).
          <li className="text-text-faint px-1 py-2 text-[11px]">
            <span className="num">{filtered.length}</span>명 중{" "}
            <span className="num">{shown.length}</span>명만 표시 — 이름을 입력해 좁히세요
          </li>
        )}
      </ul>
    </div>
  );
}

function PoolItem({
  student,
  assigned,
  canWrite,
}: {
  student: AssignableStudent;
  assigned: boolean;
  canWrite: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `student:${student.id}`,
    data: { type: "student", studentId: student.id, label: student.name },
    disabled: !canWrite,
  });

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`hover:bg-muted flex min-h-10 cursor-grab touch-manipulation items-baseline gap-1.5 rounded-lg px-2 py-1.5 text-[13px] active:cursor-grabbing sm:min-h-0 sm:py-1 sm:text-[12.5px] ${
        isDragging ? "opacity-50" : ""
      } ${assigned ? "opacity-55" : ""}`}
      title={assigned ? "이 시즌에 이미 배정된 학생 (다른 회차에 또 태울 수 있습니다)" : undefined}
    >
      <span className="text-text font-medium">{student.name}</span>
      {student.schoolGrade && (
        <span className="text-text-faint text-[11px]">{student.schoolGrade}</span>
      )}
      {assigned && <span className="text-text-faint ml-auto text-[10.5px]">배정됨</span>}
    </li>
  );
}
