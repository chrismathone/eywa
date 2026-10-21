"use client";

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SHUTTLE_INPUT, SHUTTLE_ROW_TEXT } from "@/features/shuttle/control-size";
import { cn } from "@/lib/utils";
import type { AssignableStudent } from "@/features/shuttle/server/students";
import type { StudentAssignment } from "@/features/shuttle/student-assignments";
import type { Season } from "@/features/shuttle/types";
import { AssignedEditor } from "./assigned-editor";

/**
 * 우열 — 배정 가능한 학생 풀(재원생). 여기서 정류장으로 끌어다 놓으면 배정되고,
 * 배정 칩을 여기로 끌어다 놓으면 해제된다(같은 곳이 원천이자 휴지통 — 방향만 반대다).
 *
 * 🔑 **검색해야 나온다**(원장 2026-08-19: *"우측 학생이 전부 보일 필요 없음, 검색한 것만 보이게"*).
 *    재원생 전원(실측 336명)을 늘 세워두면 셔틀 타는 71명을 찾는 데 방해만 되고, 항목 하나하나가
 *    dnd-kit `useDraggable` 노드라 폰에서 드래그마다 그 수만큼 측정이 돈다(좁은 화면에서 이 열이
 *    `hidden`이어도 **React는 계속 렌더**한다).
 * 🔑 **배정된 아이를 누르면** 어디에 배정됐는지 펼쳐 그 자리에서 고친다(사용자 2026-10-21) — 끄는 것은 종전대로 배정.
 * ⚠️ 건수 표시는 **참값**을 유지한다 — 잘린 배열 길이를 건수로 쓰지 말 것([[#89]]).
 */
/** 검색 결과가 넓을 때 한 번에 그리는 최대 인원. 건수 표시는 이 상한과 무관하다. */
const POOL_RENDER_CAP = 80;

export function StudentPool({
  students,
  assignments,
  season,
  canWrite,
  onError,
}: {
  students: AssignableStudent[];
  /** 학생 id → 이 시즌 배정 목록(보드 회차에서 접은 것). 있으면 배정됨. */
  assignments: ReadonlyMap<string, StudentAssignment[]>;
  season: Season;
  canWrite: boolean;
  onError: (msg: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
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
        <h3 className="text-foreground text-sm font-bold">학생</h3>
        <span className="text-text-faint text-xs">
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
        className={SHUTTLE_INPUT}
      />

      {isOver && (
        <p className="text-danger text-center text-xs font-bold">여기 놓으면 배정 해제</p>
      )}

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {shown.map((s) => (
          <PoolItem
            key={s.id}
            student={s}
            assignments={assignments.get(s.id) ?? []}
            open={openId === s.id}
            onToggle={() => setOpenId((id) => (id === s.id ? null : s.id))}
            season={season}
            canWrite={canWrite}
            onError={onError}
          />
        ))}
        {!searching && (
          // 목록이 비어 보이는 이유를 적어 둔다 — 빈 칸만 있으면 "학생이 안 나온다"로 읽힌다.
          <li className="text-text-faint px-1 py-2 text-xs leading-relaxed">
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
          <li className="text-text-faint px-1 py-2 text-xs">찾는 학생이 없습니다</li>
        )}
        {matches.length > shown.length && (
          // ⚠️ 위의 건수(matches.length)는 **참값**을 유지한다 — 잘린 배열 길이를 건수로 쓰면
          //    학생이 늘어도 숫자가 상한에 붙어 안 변한다([[#89]]).
          <li className="text-text-faint px-1 py-2 text-xs">
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
  assignments,
  open,
  onToggle,
  season,
  canWrite,
  onError,
}: {
  student: AssignableStudent;
  assignments: StudentAssignment[];
  open: boolean;
  onToggle: () => void;
  season: Season;
  canWrite: boolean;
  onError: (msg: string | null) => void;
}) {
  const assigned = assignments.length > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `student:${student.id}`,
    data: { type: "student", studentId: student.id, label: student.name },
    disabled: !canWrite,
  });

  return (
    <li className="flex flex-col">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        // 🔑 누르면(끌지 않고) 배정된 아이는 배정 목록을 편다 — 센서가 5px 넘게 끌어야 드래그라 클릭과 안 섞인다.
        onClick={assigned ? onToggle : undefined}
        aria-expanded={assigned ? open : undefined}
        className={cn(
          "hover:bg-muted flex min-h-11 cursor-grab touch-manipulation items-center gap-1.5 rounded-lg px-2 py-1.5 active:cursor-grabbing sm:min-h-0 sm:items-baseline sm:py-1",
          SHUTTLE_ROW_TEXT,
          isDragging && "opacity-50",
          assigned && !open && "opacity-55",
          open && "bg-muted",
        )}
        title={assigned ? "눌러서 배정된 곳 보기·수정 (끌면 다른 회차에 또 태울 수 있습니다)" : undefined}
      >
        {/* 🔑 라벨 자리 고정 — 이름 길이에 따라 학교·학년이 들쭉날쭉하면 눈이 매번 다시 찾는다
            (원장 2026-08-19). 학교·학년은 오른쪽 정렬, 배정됨 칸은 **비어 있어도 폭을 차지**해
            같은 x에 선다. */}
        <span className="text-foreground min-w-0 overflow-hidden font-medium text-ellipsis whitespace-nowrap">
          {student.name}
        </span>
        <span className="text-text-faint ml-auto shrink-0 text-xs">{student.schoolGrade}</span>
        <span className={cn("w-[2.9rem] shrink-0 text-right text-xs", assigned ? "text-primary font-bold underline decoration-dotted underline-offset-2" : "text-text-faint")}>
          {assigned ? `배정 ${assignments.length}` : ""}
        </span>
      </div>
      {open && assigned && (
        <AssignedEditor assignments={assignments} season={season} canWrite={canWrite} onError={onError} />
      )}
    </li>
  );
}
