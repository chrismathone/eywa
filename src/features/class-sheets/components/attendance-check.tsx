"use client";

/**
 * 출결 **체크 칸** — 누를 때마다 출석 → 결석 → 지각 → 선택 안 함 (원장 2026-08-11).
 * (그전엔 드롭다운이었다. 한 반 15명을 찍는 데 매번 열고-고르고-닫는 3동작이 들었다.)
 *
 * 🔴 **저장은 출석부·원스크린과 같은 액션**(`setAttendanceCell`) — 결석이 찍히면 시수·급여에 닿으므로
 *    게이트를 ECS가 따로 만들지 않는다(#77).
 * 🔴 **지각·결석을 고르면 사유 창이 따라 열린다**(원장 2026-08-18: *"영어 강사 시트에도 지각/결석 팝업
 *    시에 시간 혹은 사유 적는 란(수학처럼) 만들 것"*). 폼은 수학(원스크린)과 **같은 것**을 그대로 쓴다
 *    ([NoteForm](../../onescreen/components/attendance-pills.tsx)) — 두 화면이 다른 낱말을 쓰면 같은
 *    기능인지 모른다.
 *    ⚠️ **창이 순환을 막지는 않는다.** 상태는 **창이 뜨기 전에 이미 저장**돼 있고(수학은 창이 저장을
 *       가로막지만 여기선 순환이 상태를 소유한다), 창은 그 위에 얹히는 후속일 뿐이다. 그래서
 *       ① 급할 땐 Esc·바깥 클릭으로 넘기면 되고(**필수 입력 아님**) ② 결석에서 지각으로 한 칸 더 가는
 *       클릭도 그대로 먹는다. 사유 창을 순환의 **앞**에 끼우면(옛 드롭다운 계약) 그 두 가지가 다 깨진다.
 *    · 우클릭은 **상태를 안 바꾸고** 사유만 여는 보조 경로로 남는다(이미 찍힌 칸을 고칠 때).
 *    · 사유가 있으면 칸에 점(●)이 붙어 열어보지 않아도 보인다.
 * 🔴 **수정 기간(7일)이 지나도 사유는 고칠 수 있다** — 서버가 `noteOnly` 경로로 그 면제를 이미 갖고 있고
 *    (원장 2026-08-06 *"메모는 언제든 추가할 수 있어야"*, 근거는 메모가 시수·돈에 안 닿는다는 것),
 *    화면이 그 흐름을 막으면 서버에 있는 문이 없는 것이나 같다. 잠긴 칸은 **상태는 읽기 전용**인 채로
 *    사유 창만 열린다(권한·담당 반 게이트는 그대로 서버가 본다 — 면제는 '기간'뿐이다).
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
import { attendanceLabelOf } from "../lib/attendance-label";
import { useSheetLang } from "@/features/teacher-view/lang-context";
import { EMPTY_CLICK_LABEL } from "../click-hint";
import { SHEET_BOX, SHEET_BOX_READONLY } from "../ui-box";
import { ATT_SOFT } from "@/features/attendance/status-color";

/**
 * 상태별 표시 — 알약(원스크린)과 **같은 색 계열**(출석=초록·지각=앰버·결석=단정색)의 옅은 판.
 * 채움은 [`ATT_SOFT`](src/features/attendance/status-color.ts) 단일 소스, 테두리만 여기서 진하게.
 * ⚠️ 표식은 **아이콘 세트**로만 — `✓`·`✕` 글자를 아이콘 자리에 세우면 구조 가드
 *    (`eywa-icon-mapping.test.ts`)가 막는다(폰트마다 모양·너비가 달라 줄이 흔들린다).
 */
const TONE: Record<BasicAttendance, { icon: EywaIconName; cls: string }> = {
  present: { icon: "check", cls: `border-green ${ATT_SOFT.present}` },
  late: { icon: "clock", cls: `border-amber ${ATT_SOFT.late}` },
  absent: { icon: "close", cls: `border-danger ${ATT_SOFT.absent}` },
};

const BASIC: readonly string[] = ["present", "late", "absent"];
/** 순환으로 바꿔도 되는 상태 = 기록 없음이거나 3종 중 하나. */
const isEditableStatus = (status: string | null) => status === null || BASIC.includes(status);
/** 사유를 받는 상태 — 수학 알약과 **같은 계약**(출석은 즉시 저장, 창을 끼우지 않는다). */
const asksNote = (status: string | null): status is "late" | "absent" =>
  status === "late" || status === "absent";

export function AttendanceCheck({
  status,
  note,
  studentName,
  canMark,
  canNote = canMark,
  onSet,
  onClear,
  onNote,
  onRemoveMakeup,
}: {
  status: string | null;
  /** 사유 메모 — 있으면 점(●)으로 표시하고, 지각·결석 창에 **채워서** 연다(빈칸으로 열면 조용히 지워진다). */
  note: string | null;
  studentName: string;
  canMark: boolean;
  /**
   * 사유만 고칠 수 있는가 — **권한·담당 반만** 보는 값(7일 창은 안 본다, 서버 `noteOnly`와 같은 의미).
   * 안 넘기면 `canMark`를 따른다(면제를 안 배선한 화면은 종전 그대로 동작한다).
   */
  canNote?: boolean;
  onSet: (status: BasicAttendance, note?: string | null) => void;
  /** '선택 안 함' — 사유·시수 안 붙은 기본 3종만 지워진다(0203a. 손댄 기록은 서버가 거절하고 사유를 띄운다). */
  onClear: () => void;
  /**
   * 보강(수업외) 명단에서 빼기 — 수강생이 아닌 행만 넘긴다. 있으면 회색 칸이 버튼이 된다.
   * 순환(출석/결석)으로 바꾸면 보강 상태가 사라지므로 빼는 길만 연다.
   */
  onRemoveMakeup?: () => void;
  /** 메모만 저장(`noteOnly`) — 상태·시수는 서버가 읽지도 쓰지도 않는다. 잠긴 칸의 유일한 쓰기 경로. */
  onNote?: (note: string | null) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const lang = useSheetLang();
  const label = attendanceLabelOf(status, lang);

  /** 사유 창 — 세 갈래(순환 뒤 자동 · 우클릭 · 잠긴 칸)가 **같은 폼**을 쓴다(수학과 같은 낱말). */
  const notePopup = (onSave: (text: string) => void) => (
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
              onSave(text);
              setNoteOpen(false);
            }}
          />
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );

  /** 사유가 적혀 있다는 표식 — 열어보지 않아도 보인다(원스크린 알약과 같은 신호). */
  const dot = note ? (
    <span aria-hidden className="text-text-faint text-xs">
      ●
    </span>
  ) : null;

  // 권한·기간이 없으면 **컨트롤을 안 그린다** — 누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악이다
  // (2026-07-21 원장 제보, 원스크린과 같은 처방).
  if (!canMark) {
    // 🔴 단 **사유는 예외**다(서버 `noteOnly`가 7일 창을 면제한다). 기록이 있는 지각·결석 칸이면
    //    상태는 읽기 전용인 채로 사유 창만 연다 — 없는 출결을 지어내지 않도록 기록이 있을 때만.
    const noteSaver = canNote && onNote && asksNote(status) ? onNote : null;
    if (!noteSaver) {
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
    return (
      <Popover.Root open={noteOpen} onOpenChange={setNoteOpen}>
        <span ref={anchorRef} className="inline-flex w-full items-center gap-0.5">
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            onContextMenu={(e) => {
              e.preventDefault();
              setNoteOpen(true);
            }}
            aria-label={`${studentName} ${label} 사유`}
            title={`${note ? `사유: ${note}\n` : ""}수정 기간이 지나 상태는 못 바꿉니다 — 사유는 언제든 고칠 수 있습니다`}
            className={`${SHEET_BOX_READONLY} cursor-pointer justify-center`}
          >
            {label}
          </button>
          {dot}
        </span>
        {notePopup((text) => noteSaver(text.trim() || null))}
      </Popover.Root>
    );
  }

  if (!isEditableStatus(status)) {
    if (status === "makeup" && onRemoveMakeup && canMark) {
      return (
        <button
          type="button"
          className={`${SHEET_BOX} text-purple hover:bg-purple/10 w-full cursor-pointer font-bold`}
          title="클릭하면 보강 명단에서 뺍니다(출석 기록이 삭제됩니다)"
          aria-label={`${studentName} 보강 취소`}
          onClick={() => {
            if (!window.confirm(`${studentName} 보강을 명단에서 뺄까요? 출석 기록이 삭제됩니다.`)) return;
            onRemoveMakeup();
          }}
        >
          {label}
        </button>
      );
    }
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
      setNoteOpen(false);
      return onClear();
    }
    onSet(next);
    // 지각·결석이면 사유 창을 이어서 연다(원장 2026-08-18). 상태는 위에서 **이미 저장**됐으므로
    // 창을 닫아도 기록은 남는다 = 급할 땐 그냥 넘어가면 된다. 출석·선택 안 함은 창을 닫는다.
    setNoteOpen(asksNote(next));
  };

  return (
    <Popover.Root open={noteOpen} onOpenChange={setNoteOpen}>
      <span ref={anchorRef} className="inline-flex w-full items-center gap-0.5">
        <button
          type="button"
          onClick={cycle}
          // 우클릭 = **상태를 안 바꾸고** 사유만(이미 찍힌 칸을 고칠 때의 보조 경로).
          onContextMenu={(e) => {
            e.preventDefault();
            if (asksNote(status)) setNoteOpen(true);
            else toast.info("사유는 지각·결석에만 적을 수 있습니다");
          }}
          aria-label={`${studentName} 출결 — ${label ?? "선택 안 함"}`}
          title={`${note ? `사유: ${note}\n` : ""}클릭: 출석 → 결석 → 지각 → 선택 안 함\n지각·결석을 고르면 시간·사유 칸이 열립니다(안 적어도 됩니다)\n우클릭: 상태는 그대로 두고 사유만`}
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
        {dot}
      </span>
      {notePopup((text) => {
        // 상태는 지금 것을 그대로 다시 싣는다(사유만 바꾸는 저장이라 3종 밖으로 새지 않는다).
        if (asksNote(status)) onSet(status, text.trim() || null);
      })}
    </Popover.Root>
  );
}
