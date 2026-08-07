"use client";

/**
 * 출결 드롭다운 — 원장 2026-08-06 *"출결도 드랍다운으로."* 태도와 같은 컨트롤([FieldSelect])로 맞춰
 * 한 행에서 두 칸이 같은 모양·같은 폭으로 읽힌다(알약 3개는 116px를 먹고 줄마다 높이가 흔들렸다).
 *
 * 🔴 **저장은 출석부·원스크린과 같은 액션**(`setAttendanceCell`)을 쓴다 — 결석이 찍히면 시수·급여에
 *    닿으므로 게이트를 ECS가 따로 만들지 않는다(#77).
 *
 * ⚠️ 드롭다운엔 알약에 없던 **'선택 안 함'(=지우기)** 이 생긴다. 이게 그냥 `status=null` 저장이 되면
 *    사유 메모·시수까지 함께 날아간다(그래서 수학 쪽 알약은 아예 지우기를 안 만들었다). 여기서는
 *    ECS가 이미 갖고 있던 안전한 취소 경로(`ecs_clear_present`, 0169a — **plain present만** 삭제하고
 *    사유·시수가 붙었으면 거절)로 보낸다. 즉 실수로 고른 '출석'은 되돌릴 수 있고, 손댄 기록은 못 지운다.
 * ⚠️ 조퇴·공결·보강처럼 3종 밖 상태는 **바꾸지 않고 보여만 준다** — 드롭다운이 그 값을 3종 중 하나로
 *    덮으면 출석부에서만 쓸 수 있는 상태가 조용히 사라진다(알약 구현과 같은 판단).
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Popover } from "@base-ui/react/popover";
import { FieldSelect } from "@/features/onescreen/components/field-select";
import { NoteForm } from "@/features/onescreen/components/attendance-pills";

export type BasicAttendance = "present" | "late" | "absent";

/** 사유를 받는 상태 — 알약 구현과 **같은 집합**(지각·결석). 출석은 사유가 없으니 즉시 저장. */
const NEEDS_NOTE: ReadonlySet<string> = new Set(["late", "absent"]);

const OPTIONS = ["출석", "지각", "결석"] as const;
const TO_STATUS: Record<string, BasicAttendance> = { 출석: "present", 지각: "late", 결석: "absent" };
const TO_LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};

const BASIC: readonly string[] = ["present", "late", "absent"];
/** 드롭다운으로 바꿔도 되는 상태 = 기록 없음이거나 3종 중 하나. */
const isEditableStatus = (status: string | null) => status === null || BASIC.includes(status);

export function AttendanceSelect({
  status,
  note,
  studentName,
  canMark,
  onSet,
  onClear,
}: {
  status: string | null;
  /** 사유 메모 — 값이 있으면 툴팁으로 보여 준다(여기서 고치진 않는다. 편집은 출석부·원스크린). */
  note: string | null;
  studentName: string;
  canMark: boolean;
  onSet: (status: BasicAttendance, note?: string | null) => void;
  /** '선택 안 함' — plain present만 지워진다(그 외는 서버가 거절하고 사유를 띄운다). */
  onClear: () => void;
}) {
  // 지각·결석을 고르면 사유를 먼저 받는다(저장은 확인 후) — 알약과 같은 계약.
  const [noteFor, setNoteFor] = useState<BasicAttendance | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const label = status ? (TO_LABEL[status] ?? status) : null;

  // 권한·기간이 없으면 **컨트롤을 안 그린다** — 누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악이다
  // (2026-07-21 원장 제보, 원스크린과 같은 처방).
  if (!canMark) {
    return (
      <span
        className="bg-bg-soft text-text-dim rounded-pill inline-block truncate px-1.5 py-0.5 text-[11px] font-bold"
        title={
          note
            ? `${label ?? "출결 없음"} · ${note} — 출결 입력 권한이 없거나 수정 기간이 지났습니다`
            : "출결 입력 권한이 없거나 수정 기간이 지났습니다"
        }
      >
        {label ?? "—"}
      </span>
    );
  }

  if (!isEditableStatus(status)) {
    return (
      <span
        className="bg-bg-soft text-text-dim rounded-pill inline-block truncate px-1.5 py-0.5 text-[11px] font-bold"
        title="조퇴·공결·보강은 출석부에서 변경하세요(여기서 바꾸면 그 상태가 사라집니다)"
      >
        {label}
      </span>
    );
  }

  return (
    <Popover.Root open={noteFor !== null} onOpenChange={(o) => !o && setNoteFor(null)}>
      {/* ⚠️ `Popover.Trigger`를 쓰지 않는다 — 트리거는 **네이티브 <button>** 을 요구하는데(base-ui 경고),
          이 칸의 실제 컨트롤은 드롭다운이라 버튼 안에 콤보박스를 넣는 잘못된 중첩이 된다.
          여는 주체는 드롭다운 선택이므로 위치만 `anchor`로 이 칸에 붙인다. */}
      <span
        ref={anchorRef}
        className="inline-flex w-full items-center gap-0.5"
        title={
          note
            ? `${studentName} · ${label ?? ""} 사유: ${note} — 같은 값을 다시 고르면 사유를 고칠 수 있습니다`
            : undefined
        }
      >
        <span className="min-w-0 flex-1">
          <FieldSelect
            options={OPTIONS}
            value={label}
            ariaLabel={`${studentName} 출결`}
            onSelect={(v) => {
              // FieldSelect는 '선택 안 함'을 **항상** 끼워 넣는데, 0169a 취소는 plain present만 지운다.
              // 지각·결석에서 그대로 호출하면 낙관 삭제 → 서버 거절 → 롤백이 매번 반복되는 **죽은 컨트롤**이
              // 된다(지워진 것처럼 보였다 돌아오는 거짓 성공). 왕복 없이 이유부터 말한다.
              if (v === null) {
                if (status && status !== "present") {
                  toast.info("지각·결석 기록은 출석부에서 지워 주세요(사유·시수가 함께 지워집니다)");
                  return;
                }
                return onClear();
              }
              const next = TO_STATUS[v];
              if (!next) return;
              // 지각·결석은 **같은 값을 다시 골라도** 사유 창을 연다(= 사유 수정 경로). 알약이
              // 활성 재클릭으로 하던 일을 드롭다운에선 이렇게 남긴다.
              if (NEEDS_NOTE.has(next)) return setNoteFor(next);
              if (next !== status) onSet(next);
            }}
          />
        </span>
        {/* 사유가 있으면 점 하나 — 열어보지 않아도 "사유가 적혀 있다"가 보인다(원스크린 알약과 같은 신호). */}
        {note ? (
          <span aria-hidden className="text-text-faint text-[8px]">
            ●
          </span>
        ) : null}
      </span>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchorRef}
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <Popover.Popup className="bg-card border-line shadow-card w-[240px] rounded-lg border p-2 outline-none">
            {/* key=열 때마다 서버 값으로 다시 시작(남이 고친 사유가 반영되게) — 알약과 동일. */}
            <NoteForm
              key={note ?? ""}
              initial={note ?? ""}
              label={`${studentName} · ${noteFor ? TO_LABEL[noteFor] : ""} 사유`}
              onCancel={() => setNoteFor(null)}
              onSave={(text) => {
                if (noteFor) onSet(noteFor, text.trim() || null);
                setNoteFor(null);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
