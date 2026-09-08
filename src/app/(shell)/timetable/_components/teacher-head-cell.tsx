"use client";

import { useState, useTransition, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { moveTeacher } from "@/features/timetable/lib/teacher-order";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";

/**
 * 기본뷰 강사 이름 머리칸 — **끌어서 같은 요일 묶음 안에서 순서를 바꾼다**(원장 2026-09-08).
 *
 * 🔑 네이티브 HTML5 드래그를 쓴다(dnd-kit 아님) — 표 머리 `<th>`를 옮기는 것이라 학생 줄 DnD(`TimetableDndArea`)와
 *    센서·컨텍스트를 섞을 이유가 없고, 열 통째 이동은 "놓는 순간 서버가 다시 그리는" 흐름이라 드래그 중 변형이
 *    필요 없다. `data-no-drag-scroll`로 바깥 `DragScrollArea`의 잡고 끌기가 이 칸에서 시작하지 않게 한다.
 * 🔴 **같은 묶음(월목↔월목)에서만** 놓인다 — 묶음·과목을 MIME 타입에 실어 `dragover`에서 판정한다
 *    (`dataTransfer.getData`는 drop 전엔 빈 문자열이지만 `types`는 읽힌다). 다른 묶음 위에선 금지 커서.
 * 🔑 저장은 **묶음 전체 순서**(화면에 있는 이름 전부)를 계정(`ui_prefs.timetable.teacherOrder`)에 쓰고
 *    `router.refresh()`로 서버가 새 순서로 다시 그린다 — 열은 표 본문 전체라 클라에서 낙관적으로 못 옮긴다.
 * ⚠️ 권한 게이트가 없다 — 남의 데이터가 아니라 **내 화면 설정**이다(학생 이동과 다른 축).
 */
const MIME_BASE = "application/x-eywa-teacher-col";

export function TeacherHeadCell({
  subject,
  groupKey,
  teachers,
  name,
  colSpan,
  className,
  style,
  children,
}: {
  subject: string;
  /** 요일 묶음 키(`mon-thu`). 같은 키끼리만 놓인다. */
  groupKey: string;
  /** 이 묶음의 현재 열 순서(화면 순) — 저장은 이 전체를 다시 쓴다. */
  teachers: readonly string[];
  name: string;
  colSpan: number;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState<"before" | "after" | null>(null);
  const [saving, startSave] = useTransition();
  // ⚠️ 브라우저가 타입을 소문자로 접는다 — 과목·묶음 키는 소문자 ASCII라 안전. 이름은 여기 넣지 않는다.
  const mime = `${MIME_BASE}/${subject}/${groupKey}`.toLowerCase();

  function sideOf(e: DragEvent<HTMLTableCellElement>): "before" | "after" {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "before" : "after";
  }

  return (
    <th
      colSpan={colSpan}
      style={style}
      draggable
      data-no-drag-scroll
      title="끌어서 순서 바꾸기 — 같은 요일 묶음 안에서만"
      aria-roledescription="draggable"
      className={`${className} cursor-grab select-none active:cursor-grabbing ${
        over === "before"
          ? "shadow-[inset_3px_0_0_var(--primary)]"
          : over === "after"
            ? "shadow-[inset_-3px_0_0_var(--primary)]"
            : ""
      } ${saving ? "opacity-60" : ""}`}
      onDragStart={(e) => {
        e.dataTransfer.setData(mime, name);
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes(mime)) return; // 다른 묶음·다른 과목 → 금지 커서
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const s = sideOf(e);
        if (s !== over) setOver(s);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes(mime)) return;
        e.preventDefault();
        const from = e.dataTransfer.getData(mime);
        const side = sideOf(e);
        setOver(null);
        if (!from || from === name) return;
        const next = moveTeacher(teachers, from, name, side);
        startSave(async () => {
          const res = await saveTimetableViewPrefs({ teacherOrder: { [subject]: { [groupKey]: next } } });
          // 저장이 막히면 말한다 — 조용히 새로고침만 하면 "드래그가 안 된다"로 읽힌다(드롭 거절 토스트와 같은 규약).
          if (!res.ok) return toast.error(res.error ?? "강사 순서를 저장하지 못했습니다");
          router.refresh();
        });
      }}
    >
      {children}
    </th>
  );
}
