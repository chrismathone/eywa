"use client";

/**
 * 출결 인라인 pill(2단계) — 출석/지각/결석 1클릭, 출석부(attendance_records)와 같은 기록에 저장.
 * - 활성 pill 재클릭 = no-op(삭제 아님 — 기록 지우기는 출석부에서만: status=null 삭제가 메모·시수까지 지움).
 * - raw가 3종 외(조퇴/공결/보강)면 pill 대신 한글 배지 — 축약값 되쓰기로 raw를 파괴하지 않게, 변경은 출석부에서.
 * - pending(in-flight) 동안 잠금 — 연속 클릭 응답 역전 방지.
 * (출결 status는 코드 고정 enum(운영 enum 아님) — 라벨 맵은 출석부 UI와 동일 관례.)
 *
 * **2026-08-05 원장 요청 2종을 여기 얹었다**(표뷰·카드뷰 공용이라 한 곳만 고치면 둘 다 따라온다):
 *  ① **지각·결석 사유 메모** — 고르면 작은 입력창이 뜨고, 저장하면 출석부 메모(`attendance_records.note`)로
 *     들어간다. 이미 찍힌 라벨에 **마우스를 올리면** 같은 창이 열려 고쳐 쓸 수 있다.
 *     (출석은 사유가 없으니 즉시 저장 — 가장 자주 누르는 버튼에 창을 끼우지 않는다.)
 *  ② **수업타임(시수)** — 기본 1. 한 타임 더 했으면 2로 고쳐 출석부에 그대로 반영한다
 *     (`attendance_records.session_units`). ⚠️ **학부모 보고서엔 안 나간다** — 발송물이 아니라 기록이다
 *     (원장: "메타데이터로 '수업보고서에 발송되지 않는' 수업타임").
 *
 * 🔴 시수는 **급여 정산·청구 회차 소비가 읽는 값**이다(0115a·settlement-queries). 원장 확인 후 강사가 직접
 *    고치도록 열었고, 화면 툴팁도 그 사실을 숨기지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { effectiveUnits, formatSessionUnits } from "@/features/attendance/session-units";
import { ATT_SOLID } from "@/features/attendance/status-color";

export type BasicAttendance = "present" | "late" | "absent";
/** 저장 부가값 — 넘기지 않은 필드는 서버가 기존 값을 유지한다(setAttendanceCell 규약). */
export type AttendanceExtra = { note?: string | null; units?: string };

const BASIC: readonly BasicAttendance[] = ["present", "late", "absent"];
/** 사유 메모를 물어보는 상태. */
const NEEDS_NOTE: ReadonlySet<string> = new Set(["late", "absent"]);
const LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};
/**
 * 활성색 = [`status-color.ts`](src/features/attendance/status-color.ts) 단일 소스(`ATT_SOLID`).
 * ⚠️ v4 이전 출석=primary(네이비)는 출석부 격자의 민트와 어긋났다 — 같은 '출석'은 어디서나 초록 계열.
 */
const ON_CLS: Record<BasicAttendance, string> = ATT_SOLID;

export function AttendancePills({
  value,
  note,
  units,
  pending,
  onSet,
  studentName,
  readOnly,
  showUnits = false,
}: {
  value: string | null | undefined; // raw status(null=기록 없음)
  /** 현재 출석부 메모 — 지각·결석 팝업의 초기값. */
  note?: string | null;
  /** 현재 시수(null=기본 1). */
  units?: number | null;
  pending: boolean; // 이 (학생×반) 저장 중 — 잠금
  onSet: (status: BasicAttendance, extra?: AttendanceExtra) => void;
  studentName: string;
  /** 출결 쓰기 권한 없음(학원설정 역할·권한) — 누를 수 있는 것처럼 보이지 않게 표시만 한다. */
  readOnly?: boolean;
  /**
   * 수업타임을 이 컴포넌트가 **함께** 그릴지. 기본은 끔 — 표뷰는 **전용 열**, 카드는 헤더 옆에
   * [SessionUnitsField]를 따로 배치한다(원장 2026-08-05: "타임이 너무 작다. 표 모드에서는 열을 하나 더
   * 추가해서라도 넣어"). pill 옆에 붙이면 자리가 없어 계속 작아진다.
   */
  showUnits?: boolean;
}) {
  // ⚠️ 권한이 없으면 **버튼을 아예 내보내지 않는다**(2026-07-21 원장 제보) — 예전엔 pill이 그대로 눌려서
  // 서버가 "출석 관리 권한이 없습니다"로 거절했고, 강사는 왜 안 되는지 모른 채 계속 눌렀다.
  // 할 수 없는 일을 할 수 있는 것처럼 보여주지 않는다(#77의 반대 방향 사례).
  if (readOnly) {
    return (
      <span
        className="bg-bg-soft text-text-dim rounded-pill px-1.5 py-px text-[10px] font-bold"
        title="출결 입력 권한이 없습니다 — 학원설정(역할·권한)에서 원장님이 열어줄 수 있습니다"
      >
        {value ? (LABEL[value] ?? value) : "출결 —"}
      </span>
    );
  }
  if (value && !BASIC.includes(value as BasicAttendance)) {
    return (
      <span
        className="bg-bg-soft text-text-dim rounded-pill px-1.5 py-px text-[10px] font-bold"
        title="조퇴·공결·보강 상태는 출석부에서 변경하세요 (원스크린 pill은 출석/지각/결석만)"
      >
        {LABEL[value] ?? value}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
      <span className="inline-flex gap-0.5" role="group" aria-label={`${studentName} 출결`}>
        {BASIC.map((s) => (
          <StatusPill
            key={s}
            status={s}
            active={value === s}
            note={note ?? ""}
            pending={pending}
            studentName={studentName}
            onSet={onSet}
          />
        ))}
      </span>
      {showUnits ? (
        <SessionUnitsField
          units={units}
          status={(value as BasicAttendance | null | undefined) ?? null}
          pending={pending}
          studentName={studentName}
          onSet={onSet}
        />
      ) : null}
    </span>
  );
}

/**
 * pill 1개. 지각·결석은 **사유 창을 거쳐** 저장하고, 이미 그 상태로 찍힌 라벨은 **마우스를 올리면** 다시 열려
 * 고칠 수 있다(원장: "다시 라벨에 마우스 올리면 수정 저장 가능하게").
 *
 * ⚠️ hover로 여는 건 **활성 라벨만** — 안 찍힌 pill까지 열리면 마우스가 지나가기만 해도 창이 따라붙어
 *    표가 어지럽다. 상태를 **바꾸는** 클릭은 창을 거치므로 오작동으로 상태가 먼저 바뀌는 일도 없다.
 */
function StatusPill({
  status,
  active,
  note,
  pending,
  studentName,
  onSet,
}: {
  status: BasicAttendance;
  active: boolean;
  note: string;
  pending: boolean;
  studentName: string;
  onSet: (status: BasicAttendance, extra?: AttendanceExtra) => void;
}) {
  const [open, setOpen] = useState(false);
  const asks = NEEDS_NOTE.has(status);

  const pill = (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (asks) return setOpen(true); // 활성 재클릭도 '사유 수정'으로(재클릭 no-op은 상태 변경에만 해당)
        if (!active) onSet(status);
      }}
      onMouseEnter={asks && active ? () => setOpen(true) : undefined}
      aria-pressed={active}
      title={
        asks
          ? active
            ? `${LABEL[status]} — 사유 메모 수정 (기록 지우기는 출석부에서)`
            : `${LABEL[status]}로 기록 — 사유 메모를 적을 수 있습니다`
          : active
            ? `${LABEL[status]} (기록 지우기는 출석부에서)`
            : `${LABEL[status]}로 기록`
      }
      className={`rounded-pill px-1.5 py-px text-[10px] font-bold transition disabled:opacity-50 ${
        active ? ON_CLS[status] : "border-line text-text-faint hover:bg-bg-soft hover:text-text-dim border"
      }`}
    >
      {LABEL[status]}
      {/* 메모가 있으면 점 하나 — 열어보지 않아도 "사유가 적혀 있다"가 보인다. */}
      {active && note ? (
        <span aria-hidden className="ml-0.5 align-middle text-[8px]">
          ●
        </span>
      ) : null}
    </button>
  );

  if (!asks) return pill;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={pill} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[240px] rounded-lg border p-2 outline-none">
            {/* key=열릴 때마다 서버 값으로 다시 시작(남이 고친 메모가 반영되게). */}
            <NoteForm
              key={note}
              initial={note}
              label={`${studentName} · ${LABEL[status]} 사유`}
              onCancel={() => setOpen(false)}
              onSave={(text) => {
                onSet(status, { note: text.trim() || null });
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * 사유 메모 입력 — Enter 저장(줄바꿈은 Shift+Enter), Esc 취소. 한 줄 사유가 대부분이라 손이 덜 간다.
 * ECS 출결 체크 순환([attendance-check.tsx](src/features/class-sheets/components/attendance-check.tsx))과
 * 오늘 카드 알약([today-attendance-pills.tsx](src/features/class-sheets/components/today-attendance-pills.tsx))도
 * **이 폼을 그대로** 쓴다 — 컨트롤은 달라도 "지각·결석엔 사유를 받는다"는 계약은 하나다.
 */
export function NoteForm({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="space-y-1.5">
      <p className="text-text-faint text-[10px] font-bold">{label}</p>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(text);
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={2}
        placeholder="예: 학원버스 지연 / 병결(부모 연락)"
        className="border-line bg-card focus:border-primary w-full resize-none rounded-md border px-1.5 py-1 text-[11px] outline-none"
      />
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-text-faint hover:text-foreground cursor-pointer px-1.5 py-0.5 text-[11px]"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onSave(text)}
          className="bg-primary text-primary-foreground cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-bold"
        >
          저장
        </button>
      </div>
    </div>
  );
}

/**
 * 수업타임(시수) — 기본 1. 1이면 흐리게, 고치면 진하게 남아 "손댄 칸"이 눈에 띈다.
 *
 * ⚠️ 출결 기록이 없는 칸에 시수만 넣을 수는 없다(원장 키가 상태 행이다) → 상태가 비어 있으면 **출석으로**
 *    함께 찍는다. "수업타임을 적었다 = 그 수업을 했다"가 사실에 가장 가깝고, 아무 일도 안 일어나
 *    "적었는데 무반응"이 되는 것보다 낫다(툴팁으로 밝힌다).
 * ⚠️ **결석에는 안 보인다** — 결석은 시수 소비 대상이 아니다(COUNTABLE_STATUSES). 보이면 적을 수 있는 것처럼
 *    보이고, 적어도 집계에 안 잡혀 거짓 어포던스가 된다.
 */
export function SessionUnitsField({
  units,
  status,
  pending,
  studentName,
  onSet,
  size = "md",
  label,
  box,
}: {
  units: number | null | undefined;
  status: BasicAttendance | null;
  pending: boolean;
  studentName: string;
  onSet: (status: BasicAttendance, extra?: AttendanceExtra) => void;
  /** md=칸 옆(카드) · lg=전용 열(표). 둘 다 읽을 수 있는 크기다 — 예전 10px는 원장이 "너무 작다"고 지적. */
  size?: "md" | "lg";
  /** 앞에 붙일 라벨. 전용 열처럼 머리글이 이미 '타임'이면 생략한다(같은 말 두 번 금지). */
  label?: string;
  /**
   * 박스 스타일(테두리·높이·폭)을 통째로 교체 — 이웃 칸과 테두리가 반드시 같아야 하는 표에서만
   * (ECS 시트 = `SHEET_BOX_UNITS`). 넘겨도 **글자 굵기는 여기가 정한다**(기본 1은 흐리게, 고치면 굵게 =
   * "손댄 칸" 신호). 미지정이면 기존 `size` 치수 그대로 — 다른 화면 영향 0.
   */
  box?: string;
}) {
  const saved = effectiveUnits(units);
  const [draft, setDraft] = useState<string | null>(null); // null = 편집 중 아님(서버 값 표시)
  const savedText = formatSessionUnits(saved);
  const big = size === "lg";
  // 결석은 시수를 소비하지 않는다 — 전용 열에선 **빈 칸으로 두지 않고** 왜 못 적는지 보여준다
  // (열이 비면 "입력이 안 되나?"가 되고, 인라인이면 자리만 먹으므로 아예 지운다).
  if (status === "absent") {
    return big ? (
      <span
        className="text-text-faint block text-center text-[13px]"
        title="결석은 수업타임(시수)을 쓰지 않습니다 — 출석·지각으로 바꾸면 입력할 수 있습니다"
      >
        —
      </span>
    ) : null;
  }

  const field = (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? savedText}
      disabled={pending}
      aria-label={`${studentName} 수업타임`}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        const next = e.target.value.trim();
        setDraft(null);
        if (!next || next === savedText) return; // 무변경이면 왕복 안 함
        onSet(status ?? "present", { units: next });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className={`bg-transparent text-center outline-none transition-colors disabled:opacity-50 ${
        box ??
        `border-line focus:border-primary rounded-md border ${
          big ? "h-8 w-[54px] text-[15px]" : "h-7 w-[46px] text-[13px]"
        }`
      } ${saved === 1 ? "text-text-dim" : "text-foreground font-bold"}`}
    />
  );

  return (
    <span
      className={`inline-flex items-center gap-1 ${big ? "justify-center" : ""}`}
      title={
        `${studentName} 수업타임 — 기본 1타임. 한 타임 더 했으면 2로 고치면 출석부에 그대로 들어갑니다.` +
        (status ? "" : " (지금 출결이 비어 있어 '출석'으로 함께 기록됩니다)") +
        " ※ 학부모 보고서에는 나가지 않습니다. 급여 시수에는 반영됩니다."
      }
    >
      {label ? <span className="text-text-faint text-[11px] font-bold whitespace-nowrap">{label}</span> : null}
      {field}
    </span>
  );
}
