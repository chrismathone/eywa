"use client";

/**
 * 출결 **체크 칸** — 누를 때마다 출석 → 결석 → 지각 → 선택 안 함 (원장 2026-08-11).
 * (그전엔 드롭다운이었다. 한 반 15명을 찍는 데 매번 열고-고르고-닫는 3동작이 들었다.)
 *
 * 🔴 **저장은 출석부·원스크린과 같은 액션**(`setAttendanceCell`) — 결석이 찍히면 시수·급여에 닿으므로
 *    게이트를 ECS가 따로 만들지 않는다(#77).
 * 🔴 **사유 창을 순환에 끼우지 않는다.** 드롭다운 시절엔 지각·결석을 고르면 사유 입력을 먼저 받았는데,
 *    그 계약을 그대로 두면 결석에서 지각으로 한 칸 가는 데 팝오버를 닫아야 한다 = 순환이 성립하지 않는다.
 *    → **왼쪽 클릭은 즉시 저장**, **오른쪽 클릭이 사유 창**이다(사유는 원래도 출석부·원스크린에서 고칠 수
 *    있었고, 여기선 보조 경로로 남긴다). 사유가 있으면 칸에 점(●)이 붙어 열어보지 않아도 보인다.
 * ⚠️ '선택 안 함'은 **손 안 댄 기록만** 지워진다(`ecs_clear_present` — 0169a는 present만이었고
 *    **0203a가 지각·결석까지 넓혔다**. 사유·시수가 붙었으면 여전히 서버가 거절한다).
 *    사유가 적힌 칸은 그 단계를 건너뛰고 **출석으로 이어 준다** — 순환이 막다른 길이 되면 오클릭한
 *    결석에서 빠져나올 수가 없다(gotcha #103).
 * ⚠️ 조퇴·공결·보강처럼 3종 밖 상태는 **바꾸지 않고 보여만 준다** — 여기서 덮으면 출석부에서만 쓸 수
 *    있는 상태가 조용히 사라진다.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Popover } from "@base-ui/react/popover";
import { NoteForm } from "@/features/onescreen/components/attendance-pills";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { nextAttendance, type BasicAttendance } from "../lib/mark-cycle";
import { EMPTY_CLICK_LABEL } from "../click-hint";
import { SHEET_BOX, SHEET_BOX_READONLY } from "../ui-box";

const TO_LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};

/**
 * 상태별 표시 — 알약(원스크린)과 **같은 색 계열**(출석=브랜드·지각=앰버·결석=단정색)의 옅은 판.
 * ⚠️ 표식은 **아이콘 세트**로만 — `✓`·`✕` 글자를 아이콘 자리에 세우면 구조 가드
 *    (`eywa-icon-mapping.test.ts`)가 막는다(폰트마다 모양·너비가 달라 줄이 흔들린다).
 */
const TONE: Record<BasicAttendance, { icon: EywaIconName; cls: string }> = {
  present: { icon: "check", cls: "border-primary bg-primary-soft text-primary" },
  late: { icon: "clock", cls: "border-amber bg-amber-soft text-amber" },
  absent: { icon: "close", cls: "border-danger bg-danger-soft text-danger" },
};

const BASIC: readonly string[] = ["present", "late", "absent"];
/** 순환으로 바꿔도 되는 상태 = 기록 없음이거나 3종 중 하나. */
const isEditableStatus = (status: string | null) => status === null || BASIC.includes(status);

export function AttendanceCheck({
  status,
  note,
  studentName,
  canMark,
  onSet,
  onClear,
}: {
  status: string | null;
  /** 사유 메모 — 있으면 점(●)으로 표시하고 우클릭으로 고친다. */
  note: string | null;
  studentName: string;
  canMark: boolean;
  onSet: (status: BasicAttendance, note?: string | null) => void;
  /** '선택 안 함' — 사유·시수 안 붙은 기본 3종만 지워진다(0203a. 손댄 기록은 서버가 거절하고 사유를 띄운다). */
  onClear: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const label = status ? (TO_LABEL[status] ?? status) : null;

  // 권한·기간이 없으면 **컨트롤을 안 그린다** — 누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악이다
  // (2026-07-21 원장 제보, 원스크린과 같은 처방).
  if (!canMark) {
    return (
      <span
        className={SHEET_BOX_READONLY}
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
        className={SHEET_BOX_READONLY}
        title="조퇴·공결·보강은 출석부에서 변경하세요(여기서 바꾸면 그 상태가 사라집니다)"
      >
        {label}
      </span>
    );
  }

  const tone = status ? TONE[status as BasicAttendance] : null;

  const cycle = () => {
    const next = nextAttendance(status);
    if (next === null) {
      // 🔴 **순환은 절대 막다른 길이 되면 안 된다.** 사유가 적힌 기록은 여기서 못 지우는데(사람이 쓴
      //    문장이라 출석부에서만), 그때 아무 일도 안 일어나면 지각 칸에서 영영 못 빠져나온다 —
      //    오클릭한 결석에 갇히는 것이 정확히 gotcha #103이 말하는 잠긴 문이다. 이유를 말하고
      //    **순환은 다음 칸(출석)으로 이어 준다**.
      if (note && note.trim()) {
        toast.info("사유가 적힌 기록은 출석부에서 지워 주세요(사유·시수가 함께 지워집니다)");
        return onSet("present");
      }
      // 사유 없는 기록은 서버가 지운다(0203a로 지각·결석까지 넓힘 — 그 전엔 present만 지워지고
      // 지각·결석은 서버가 이유와 함께 거절한다. 적용되면 이 칸이 그대로 '선택 안 함'이 된다).
      return onClear();
    }
    onSet(next);
  };

  return (
    <Popover.Root open={noteOpen} onOpenChange={setNoteOpen}>
      <span ref={anchorRef} className="inline-flex w-full items-center gap-0.5">
        <button
          type="button"
          onClick={cycle}
          // 사유 편집은 **보조 경로**라 우클릭에 둔다(왼쪽 클릭은 순환을 막지 않아야 한다).
          onContextMenu={(e) => {
            e.preventDefault();
            if (status && status !== "present") setNoteOpen(true);
            else toast.info("사유는 지각·결석에만 적을 수 있습니다");
          }}
          aria-label={`${studentName} 출결 — ${label ?? "선택 안 함"}`}
          title={`${note ? `사유: ${note}\n` : ""}클릭: 출석 → 결석 → 지각 → 선택 안 함\n우클릭: 지각·결석 사유`}
          className={`${SHEET_BOX} inline-flex w-full cursor-pointer items-center justify-center gap-0.5 px-0.5 transition ${
            tone ? tone.cls : "text-text-faint hover:bg-bg-soft"
          }`}
        >
          {tone ? (
            <>
              <EyIcon name={tone.icon} size={11} className="shrink-0" />
              <span className="truncate">{label}</span>
            </>
          ) : (
            // 빈 칸이라도 **누를 수 있다는 걸 모양으로** 말한다(원장 2026-08-13 "클릭할 수 있는 곳은
            // 클릭할 수 있음을 암시하는 라벨"). '—'는 "값 없음"이지 "눌러라"가 아니었다.
            // ⚠️ 읽기 전용 칸(권한 없음·조퇴 등)은 그대로 '—'/값이다 — 못 누르는 칸이 눌러 보이면 안 된다.
            <span aria-hidden>{EMPTY_CLICK_LABEL}</span>
          )}
        </button>
        {/* 사유가 있으면 점 하나 — 열어보지 않아도 "사유가 적혀 있다"가 보인다(원스크린 알약과 같은 신호). */}
        {note ? (
          <span aria-hidden className="text-text-faint text-[8px]">
            ●
          </span>
        ) : null}
      </span>
      <Popover.Portal>
        <Popover.Positioner anchor={anchorRef} side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[240px] rounded-lg border p-2 outline-none">
            {/* key=열 때마다 서버 값으로 다시 시작(남이 고친 사유가 반영되게) — 알약과 동일. */}
            <NoteForm
              key={note ?? ""}
              initial={note ?? ""}
              label={`${studentName} · ${label ?? ""} 사유`}
              onCancel={() => setNoteOpen(false)}
              onSave={(text) => {
                if (status === "late" || status === "absent") onSet(status, text.trim() || null);
                setNoteOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
