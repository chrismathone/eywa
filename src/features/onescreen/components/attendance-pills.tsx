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
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

export type BasicAttendance = "present" | "late" | "absent";
/** 저장 부가값 — 넘기지 않은 필드는 서버가 기존 값을 유지한다(setAttendanceCell 규약). */
export type AttendanceExtra = { note?: string | null; units?: string };

const BASIC: readonly BasicAttendance[] = ["present", "late", "absent"];
/** 사유 메모를 물어보는 상태. */
const NEEDS_NOTE: ReadonlySet<string> = new Set(["late", "absent"]);
// 🔴 라벨 사본을 두지 않는다 — 앱 전역 `attendanceLabelOf`(한·영 표가 나란한 단일 소스)를 그대로 쓴다.
//    예전 로컬 맵은 상태가 늘 때 따라오지 못해 raw enum이 새는 계열이었다(팔레트 v4 감사와 같은 결).
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
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  // ⚠️ 권한이 없으면 **버튼을 아예 내보내지 않는다**(2026-07-21 원장 제보) — 예전엔 pill이 그대로 눌려서
  // 서버가 "출석 관리 권한이 없습니다"로 거절했고, 강사는 왜 안 되는지 모른 채 계속 눌렀다.
  // 할 수 없는 일을 할 수 있는 것처럼 보여주지 않는다(#77의 반대 방향 사례).
  if (readOnly) {
    return (
      <span
        className="bg-bg-soft text-text-dim rounded-pill px-1.5 py-px text-xs font-bold"
        title={t("os.att.noPerm")}
      >
        {value ? (attendanceLabelOf(value, lang) ?? value) : t("os.att.empty")}
      </span>
    );
  }
  if (value && !BASIC.includes(value as BasicAttendance)) {
    return (
      <span
        className="bg-bg-soft text-text-dim rounded-pill px-1.5 py-px text-xs font-bold"
        title={t("os.att.otherStates")}
      >
        {attendanceLabelOf(value, lang) ?? value}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
      <span className="inline-flex gap-0.5" role="group" aria-label={tf("os.att.group", { name: studentName })}>
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

  const lang = useSheetLang();
  const tf = useSheetTf();
  // 라벨은 앱 전역 단일 소스 — 모르는 상태는 enum 대신 그대로(폴백 규약).
  const label = attendanceLabelOf(status, lang) ?? status;
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
            ? tf("os.att.editNote", { label })
            : tf("os.att.markWithNote", { label })
          : active
            ? tf("os.att.already", { label })
            : tf("os.att.mark", { label })
      }
      className={`rounded-pill px-1.5 py-px text-xs font-bold transition disabled:opacity-50 ${
        active ? ON_CLS[status] : "border-line text-text-faint hover:bg-bg-soft hover:text-text-dim border"
      }`}
    >
      {label}
      {/* 메모가 있으면 점 하나 — 열어보지 않아도 "사유가 적혀 있다"가 보인다. */}
      {active && note ? (
        <span aria-hidden className="ml-0.5 align-middle text-xs">
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
              label={tf("os.att.noteLabel", { name: studentName, label })}
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
  onDraft,
  maxLength,
}: {
  initial: string;
  label: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  /**
   * **입력하는 동안 자동 저장**(원장 2026-09-10 자리 출석부 *"실시간 저장도"*) — 글자마다 불린다.
   * 🔵 넘기는 쪽이 디바운스를 갖고 있어야 한다(자리 화면은 `saveNote`가 800ms 디바운스 + 언마운트 flush).
   * ⚠️ 이 prop을 주면 **취소 버튼이 사라진다** — 이미 저장된 글을 '취소'라 부르면 거짓말이다.
   *    안 주면(ECS·원스크린) 종전 그대로 저장/취소 두 버튼이다.
   */
  onDraft?: (text: string) => void;
  /** 글자 수 상한 — 서버가 같은 값으로 거절하는 화면만 넘긴다(자리 출석부 `SEAT_NOTE_MAXLEN`). 없으면 무제한(종전). */
  maxLength?: number;
}) {
  const t = useSheetT();
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="space-y-1.5">
      <p className="text-text-faint text-xs font-bold">{label}</p>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onDraft?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(text);
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={2}
        maxLength={maxLength}
        placeholder={t("os.att.notePh")}
        className="border-line bg-card focus:border-primary w-full resize-none rounded-md border px-1.5 py-1 text-xs outline-none"
      />
      <div className="flex items-center justify-end gap-1">
        {onDraft ? (
          // 자동 저장 중 — 되돌릴 것이 없으니 '취소'를 세우지 않는다(누르면 이미 저장된 글이 남아 거짓말).
          <span className="text-text-faint mr-auto text-xs">{t("os.att.autosave")}</span>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="text-text-faint hover:text-foreground cursor-pointer px-1.5 py-0.5 text-xs"
          >
            {t("os.att.cancel")}
          </button>
        )}
        <button
          type="button"
          onClick={() => onSave(text)}
          className="bg-primary text-primary-foreground cursor-pointer rounded-md px-2 py-0.5 text-xs font-bold"
        >
          {t("os.att.save")}
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
  const t = useSheetT();
  const tf = useSheetTf();
  const saved = effectiveUnits(units);
  const [draft, setDraft] = useState<string | null>(null); // null = 편집 중 아님(서버 값 표시)
  const savedText = formatSessionUnits(saved);
  const big = size === "lg";
  // 결석은 시수를 소비하지 않는다 — 전용 열에선 **빈 칸으로 두지 않고** 왜 못 적는지 보여준다
  // (열이 비면 "입력이 안 되나?"가 되고, 인라인이면 자리만 먹으므로 아예 지운다).
  if (status === "absent") {
    return big ? (
      <span
        className="text-text-faint block text-center text-sm"
        title={t("os.units.absent")}
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
      aria-label={tf("os.units.aria", { name: studentName })}
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
          big ? "h-8 w-[54px] text-base" : "h-7 w-[46px] text-sm"
        }`
      } ${saved === 1 ? "text-text-dim" : "text-foreground font-bold"}`}
    />
  );

  return (
    <span
      className={`inline-flex items-center gap-1 ${big ? "justify-center" : ""}`}
      title={
        tf("os.units.title", { name: studentName }) +
        (status ? "" : t("os.units.titleNoStatus")) +
        t("os.units.titleTail")
      }
    >
      {label ? <span className="text-text-faint text-xs font-bold whitespace-nowrap">{label}</span> : null}
      {field}
    </span>
  );
}
