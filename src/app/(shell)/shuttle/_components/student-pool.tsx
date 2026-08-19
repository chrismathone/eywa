"use client";

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { AssignableStudent } from "@/features/shuttle/server/students";

/**
 * 우열 — 배정 가능한 학생 풀(재원생). 여기서 정류장으로 끌어다 놓으면 배정되고,
 * 배정 칩을 여기로 끌어다 놓으면 해제된다(같은 곳이 원천이자 휴지통 — 방향만 반대다).
 *
 * 🔑 **검색해야 나온다**(원장 2026-08-19: *"우측 학생이 전부 보일 필요 없음, 검색한 것만 보이게"*).
 *    재원생 전원(실측 336명)을 늘 세워두면 셔틀 타는 71명을 찾는 데 방해만 되고, 항목 하나하나가
 *    dnd-kit `useDraggable` 노드라 폰에서 드래그마다 그 수만큼 측정이 돈다(좁은 화면에서 이 열이
 *    `hidden`이어도 **React는 계속 렌더**한다).
 * ⚠️ 건수 표시는 **참값**을 유지한다 — 잘린 배열 길이를 건수로 쓰지 말 것([[#89]]).
 */
/** 검색 결과가 넓을 때 한 번에 그리는 최대 인원. 건수 표시는 이 상한과 무관하다. */
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

  const key = q.replace(/\s+/g, "").toLowerCase();
  const searching = key.length > 0;

  /** 검색 전에는 **아무도 그리지 않는다** — 목록은 검색으로만 열린다. */
  const matches = useMemo(
    () => (key ? students.filter((s) => s.searchKey.includes(key)) : []),
    [students, key],
  );
  const shown = useMemo(() => matches.slice(0, POOL_RENDER_CAP), [matches]);

  return (
    <div
      ref={setNodeRef}
      // flex-1: 검색 전에는 목록이 비므로 카드가 내용 높이로 쪼그라든다 — 그러면 "여기 놓으면 배정 해제"
      // 드롭 영역이 손톱만 해진다. 열 높이를 그대로 채워 휴지통 면적을 유지한다.
      className={`bg-card flex min-h-0 flex-1 flex-col gap-2 rounded-2xl p-2.5 shadow-[var(--shadow-card)] transition-colors ${
        isOver ? "ring-danger ring-2" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-text text-[13.5px] font-bold">학생</h3>
        <span className="text-text-faint text-[11.5px]">
          {searching ? (
            <>
              <span className="num">{matches.length}</span>명 찾음
            </>
          ) : (
            <>
              전체 <span className="num">{students.length}</span>명
            </>
          )}
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
        {!searching && (
          // 목록이 비어 보이는 이유를 적어 둔다 — 빈 칸만 있으면 "학생이 안 나온다"로 읽힌다.
          <li className="text-text-faint px-1 py-2 text-[12px] leading-relaxed">
            이름이나 학교를 입력하면 여기에 나옵니다.
            {canWrite && (
              <>
                <br />
                배정된 칩을 이 칸으로 끌어다 놓으면 배정이 해제됩니다.
              </>
            )}
          </li>
        )}
        {searching && matches.length === 0 && (
          <li className="text-text-faint px-1 py-2 text-[12px]">찾는 학생이 없습니다</li>
        )}
        {matches.length > shown.length && (
          // ⚠️ 위의 건수(matches.length)는 **참값**을 유지한다 — 잘린 배열 길이를 건수로 쓰면
          //    학생이 늘어도 숫자가 상한에 붙어 안 변한다([[#89]]).
          <li className="text-text-faint px-1 py-2 text-[11px]">
            <span className="num">{matches.length}</span>명 중{" "}
            <span className="num">{shown.length}</span>명만 표시 — 이름을 더 입력해 좁히세요
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
      {/* 🔑 라벨 자리 고정 — 이름 길이에 따라 학교·학년이 들쭉날쭉하면 눈이 매번 다시 찾는다
          (원장 2026-08-19). 학교·학년은 오른쪽 정렬, '배정됨' 칸은 **비어 있어도 폭을 차지**해
          같은 x에 선다. */}
      <span className="text-text min-w-0 overflow-hidden font-medium text-ellipsis whitespace-nowrap">
        {student.name}
      </span>
      <span className="text-text-faint ml-auto shrink-0 text-[11px]">{student.schoolGrade}</span>
      <span className="text-text-faint w-[2.6rem] shrink-0 text-right text-[10.5px]">
        {assigned ? "배정됨" : ""}
      </span>
    </li>
  );
}
