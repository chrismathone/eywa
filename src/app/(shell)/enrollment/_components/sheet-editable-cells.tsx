"use client";

import { isDirectEditClick } from "@/lib/direct-edit";

import { useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill } from "@/components/atoms/pill";
import { Check, Loader2, X } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import {
  BOARD_STAGE_OPTIONS,
  dropBlockReason,
  outcomeForDrop,
  stageOfCard,
  type BoardStageKey,
} from "@/features/enrollment/board-stages";
import {
  patchConsultationCells,
  setEnrollmentOutcome,
  type ConsultationCellPatch,
} from "@/features/enrollment/server/actions";
import { statusCellOf } from "@/features/enrollment/sheet-cells";
import { useEditPresence } from "@/features/presence/edit-presence";
import { useGradeLevels } from "@/features/owner/operations-context";
import { schoolGradeLabel } from "@/lib/format/school-grade";

/**
 * 등록상담 목록뷰의 **엑셀식 인라인 편집 칸**(원장 2026-09-02: *"나머지는 더블클릭하면 엑셀처럼 수정하게"* ·
 * *"상태는 더블클릭하면 상태 변경 4개중 1개 가능하게"*).
 *
 * 규약(전 칸 공통): **더블클릭 = 열기 · Enter/✓ = 저장 · Esc/✕ = 취소 · 칸을 떠나면(blur) 바뀐 값은 저장**.
 * 저장 경로는 둘뿐이다 — 값 칸은 [`patchConsultationCells`](@/features/enrollment/server/actions)(칸 단위 PATCH),
 * 상태 칸은 칸반 드롭·상세 '상태 변경'과 **같은** `setEnrollmentOutcome`(대표값 규칙 `outcomeForDrop`·잠금
 * `dropBlockReason`도 같은 함수). 🔴 화면의 `canEdit`은 노출 조건일 뿐 게이트가 아니다(#77) — 서버가 다시 본다.
 * 🔴 '접수'(consulted_at)와 '번호'는 편집 칸이 아니다 — 접수 시각은 정렬용 timestamptz라 상세 폼도 안 건드린다.
 *
 * 🔑 저장 직후 서버 행이 따라올 때까지(router.refresh 왕복) **방금 저장한 값을 그대로 보여 준다**(`saved`) —
 *    안 그러면 수백 ms 동안 옛 값이 되돌아와 "저장이 안 됐나" 하고 두 번 저장한다. 새 행이 오면 자동 폐기.
 * ⚠️ 편집 중엔 presence를 켠다(`useEditPresence`) — 같은 상담을 상세 창에서 고치는 사람에게 '수정중'이 보인다.
 * ⚠️ 편집 칸엔 `data-no-drag-scroll` — 표가 잡고-끌기(DragScrollArea) 영역이라 드롭다운·입력 위 드래그가 팬으로 새면 안 된다.
 */

type CommitResult = { ok: true } | { error: string };

/** 칸 하나의 상태 기계. propValue = 서버가 준 현재값(문자열로 접은 것), commit = 저장 호출. */
function useCellEdit(scope: string, propValue: string, commit: (next: string) => Promise<CommitResult>) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<{ base: string; value: string } | null>(null);
  useEditPresence(scope, editing);
  // prop이 저장 당시 값 그대로면(아직 refresh 전) 저장값을, 바뀌었으면(새 행 도착) prop을 보인다.
  const shown = saved && saved.base === propValue ? saved.value : propValue;
  const open = () => setEditing(true);
  const close = () => setEditing(false);
  const save = (next: string) => {
    if (next === shown) {
      close();
      return;
    }
    startTransition(async () => {
      let r: CommitResult;
      try {
        r = await commit(next);
      } catch {
        r = { error: "저장에 실패했습니다. 다시 시도해 주세요." };
      }
      if ("error" in r) {
        // 실패는 토스트로 — 칸은 좁아서(연락처 116px) 긴 사유를 안에 적으면 행이 부푼다. 편집 상태는 유지(재시도·취소).
        toast.error(r.error);
        return;
      }
      setSaved({ base: propValue, value: next });
      setEditing(false);
      router.refresh();
    });
  };
  return { editing, open, close, save, shown, pending };
}

/**
 * 값 칸 툴팁 — 가드가 이 상수로 칸을 찾는다. 🔴 문구를 바꿀 땐 여기만 고친다(한때 화면은
 * "터치 또는 더블클릭하여 수정"인데 테스트는 옛 문구를 찾아 9건이 빨갰다 — 2026-09-15).
 */
export const EDIT_CELL_TITLE = "터치 또는 더블클릭하여 수정";

/** 값 칸의 표시면 — 더블클릭 대상. canEdit이 아니면 그냥 값(버튼 없음). */
function CellFace({
  canEdit,
  onOpen,
  empty,
  inline = false,
  className = "",
  children,
}: {
  canEdit: boolean;
  onOpen: () => void;
  /**
   * 빈 값 — 읽기 전용이면 아무것도 안 그려 `td:empty`(좁은 화면 카드가 감춘다). 편집 가능이면 더블클릭 대상이
   * 있어야 하니 버튼은 남고, 감추는 표식은 표가 **`<td data-empty>`**로 단다(자식에 달면 `:has()`가 필요한데
   * 빌드가 그 선택자를 조용히 떨어뜨렸다 — 2026-09-02 실측).
   */
  empty: boolean;
  /** 글줄 안에 서는 칸(학생이름 — 옆에 표식 알약이 이어진다). 기본은 칸 폭을 다 쓰는 블록. */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!canEdit) return empty ? null : <>{children}</>;
  return (
    <button
      type="button"
      title={EDIT_CELL_TITLE}
      onClick={(event) => { if (isDirectEditClick(event)) onOpen(); }}
      onDoubleClick={() => {
        // 더블클릭은 브라우저가 낱말을 선택한다 — 편집 칸이 열리면서 파란 선택이 남지 않게 지운다.
        window.getSelection()?.removeAllRanges();
        onOpen();
      }}
      // ⚠️ 폭 유틸은 분기해서 한 벌만(`w-full`과 `w-auto`를 같이 적으면 승자를 CSS 순서가 정한다 — [[#116]]).
      className={`hover:bg-bg-soft min-h-5 cursor-cell rounded-sm text-left ${inline ? "inline-block" : "block w-full"} ${className}`}
    >
      {children}
    </button>
  );
}

const INPUT =
  "border-border bg-card text-foreground focus:border-primary block w-full rounded-md border px-1.5 py-0.5 text-xs leading-[1.4] focus:outline-none disabled:opacity-60";

/**
 * 한 줄 입력 / 여러 줄 입력 편집기. Enter = 저장(여러 줄은 Shift+Enter가 줄바꿈), Esc = 취소, blur = 바뀌었으면 저장.
 * ⚠️ Enter·Esc로 닫힌 뒤 따라오는 blur가 한 번 더 저장/취소하지 않게 `settled`로 막는다.
 */
function TextEditor({
  initial,
  multiline,
  pending,
  onSave,
  onCancel,
  className = "",
}: {
  initial: string;
  multiline?: boolean;
  pending: boolean;
  onSave: (v: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const settled = useRef(false);
  const commit = () => {
    settled.current = true;
    onSave(draft);
  };
  const cancel = () => {
    settled.current = true;
    onCancel();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && !(multiline && e.shiftKey)) {
      e.preventDefault();
      commit();
    }
  };
  const onBlur = () => {
    if (settled.current) return;
    if (draft === initial) cancel();
    else commit();
  };
  // 엑셀처럼 커서를 글 끝에 둔다(전체 선택이 아니라 이어 쓰기).
  const onFocus = (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
    const n = e.currentTarget.value.length;
    e.currentTarget.setSelectionRange(n, n);
  };
  if (multiline) {
    return (
      <div data-no-drag-scroll>
        <textarea
          autoFocus
          value={draft}
          rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onFocus={onFocus}
          className={`${INPUT} resize-y ${className}`}
        />
        <p className="text-text-faint mt-0.5 text-xs">Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소</p>
      </div>
    );
  }
  return (
    <input
      autoFocus
      data-no-drag-scroll
      value={draft}
      disabled={pending}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onFocus={onFocus}
      className={`${INPUT} ${className}`}
    />
  );
}

/** 글자 칸 — 학생이름 · 연락처 · 상담 내용. */
export function EditableTextCell({
  id,
  field,
  value,
  canEdit,
  multiline,
  inline,
  className = "",
  children,
}: {
  id: string;
  field: "prospectName" | "parentPhone" | "parentRequest";
  value: string | null;
  canEdit: boolean;
  multiline?: boolean;
  /** 글줄 안에 서는 칸(학생이름) — 표식 알약이 옆에 이어지도록 폭을 글자만큼만 쓴다. */
  inline?: boolean;
  className?: string;
  /** 표시면(값이 있을 때). 없으면 값 그대로. */
  children?: ReactNode;
}) {
  const cell = useCellEdit(`consultation:${id}`, value ?? "", (next) => {
    const patch: ConsultationCellPatch =
      field === "prospectName"
        ? { prospectName: next }
        : field === "parentPhone"
          ? { parentPhone: next || null }
          : { parentRequest: next || null };
    return patchConsultationCells(id, patch);
  });
  if (cell.editing) {
    return (
      <TextEditor
        initial={cell.shown}
        multiline={multiline}
        pending={cell.pending}
        onSave={cell.save}
        onCancel={cell.close}
      />
    );
  }
  const shownNode = children ?? cell.shown;
  return (
    <CellFace canEdit={canEdit} onOpen={cell.open} empty={!cell.shown.trim()} inline={inline} className={className}>
      {cell.shown.trim() ? shownNode : null}
    </CellFace>
  );
}

/** 값이 없을 때 고를 수 있는 '없음' — 빈 문자열은 서버에서 null로 저장된다. */
const NONE_OPTION: ComboOption = { value: "", label: "없음" };
const SELECT_TRIGGER = "border-border bg-card text-foreground h-7 rounded-md border px-2 text-xs";

/**
 * 고르는 칸 — 상담사 · 과목. 더블클릭하면 목록이 **열린 채로** 나타나고(`defaultOpen`), 고르면 바로 저장,
 * 고르지 않고 닫으면(바깥 클릭·Esc) 취소.
 * ⚠️ 현재값이 선택지에 없으면(옛 시트 자유 텍스트 과목·퇴사한 상담사) 그 값을 목록 맨 앞에 그대로 세운다 —
 *    안 세우면 트리거가 '선택...'으로 보여 값이 없는 줄로 읽히고, 그대로 두고 닫아도 손실이 없어야 한다.
 */
export function EditableSelectCell({
  id,
  field,
  value,
  options,
  canEdit,
  children,
}: {
  id: string;
  field: "consultantId" | "subject";
  value: string | null;
  options: ComboOption[];
  canEdit: boolean;
  /** 표시면(값이 있을 때). */
  children: ReactNode;
}) {
  const cell = useCellEdit(`consultation:${id}`, value ?? "", (next) =>
    patchConsultationCells(id, field === "consultantId" ? { consultantId: next || null } : { subject: next || null }),
  );
  const chosen = useRef(false);
  if (cell.editing) {
    const current = cell.shown;
    const known = options.some((o) => o.value === current);
    const list = [
      ...(current && !known ? [{ value: current, label: current }] : []),
      NONE_OPTION,
      ...options,
    ];
    return (
      <div data-no-drag-scroll>
        <SearchableSelect
          defaultOpen
          compact
          options={list}
          value={current}
          triggerClassName={SELECT_TRIGGER}
          onValueChange={(v) => {
            chosen.current = true;
            cell.save(v);
          }}
          onOpenChange={(o) => {
            // 고르지 않고 닫힘(바깥 클릭·Esc) = 취소. 골라서 닫힌 경우는 save가 닫는다.
            if (!o && !chosen.current) cell.close();
          }}
        />
      </div>
    );
  }
  // 열 때 '골랐다' 표식을 지운다(렌더 중 ref 쓰기 금지 — 이벤트 안에서만).
  const openFresh = () => {
    chosen.current = false;
    cell.open();
  };
  return (
    <CellFace canEdit={canEdit} onOpen={openFresh} empty={!cell.shown}>
      {cell.shown ? children : null}
    </CellFace>
  );
}

/** 학교·학년 — 두 칸을 한 편집기에서. 표시는 앱 전역 `schoolGradeLabel`("경명여중1"). */
export function EditableSchoolGradeCell({
  id,
  school,
  grade,
  canEdit,
}: {
  id: string;
  school: string | null;
  grade: string | null;
  canEdit: boolean;
}) {
  const gradeLevels = useGradeLevels();
  const packed = JSON.stringify([school ?? "", grade ?? ""]);
  const cell = useCellEdit(`consultation:${id}`, packed, (next) => {
    const [s, g] = JSON.parse(next) as [string, string];
    return patchConsultationCells(id, { prospectSchool: s || null, prospectGrade: g || null });
  });
  const [s, g] = JSON.parse(cell.shown) as [string, string];
  if (cell.editing) {
    return (
      <SchoolGradeEditor
        school={s}
        grade={g}
        gradeLevels={gradeLevels}
        pending={cell.pending}
        onSave={(ns, ng) => cell.save(JSON.stringify([ns, ng]))}
        onCancel={cell.close}
      />
    );
  }
  const label = schoolGradeLabel(s, g);
  return (
    <CellFace canEdit={canEdit} onOpen={cell.open} empty={!label}>
      {label || null}
    </CellFace>
  );
}

function SchoolGradeEditor({
  school,
  grade,
  gradeLevels,
  pending,
  onSave,
  onCancel,
}: {
  school: string;
  grade: string;
  gradeLevels: string[];
  pending: boolean;
  onSave: (school: string, grade: string) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(school);
  const [g, setG] = useState(grade);
  // 학원설정 학년 + (설정에 없는 현재값이면 그것도 — 상세 폼과 같은 규칙) + 없음.
  const gradeOptions: ComboOption[] = [
    NONE_OPTION,
    ...(g && !gradeLevels.includes(g) ? [{ value: g, label: g }] : []),
    ...gradeLevels.map((x) => ({ value: x, label: x })),
  ];
  return (
    <div data-no-drag-scroll className="flex flex-col gap-1">
      <input
        autoFocus
        value={s}
        placeholder="학교"
        disabled={pending}
        onChange={(e) => setS(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            onSave(s, g);
          }
        }}
        className={INPUT}
      />
      <SearchableSelect compact options={gradeOptions} value={g} onValueChange={setG} triggerClassName={SELECT_TRIGGER} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={pending}
          title="저장(Enter)"
          onClick={() => onSave(s, g)}
          className="text-primary hover:bg-primary/10 rounded p-1 transition disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </button>
        <button
          type="button"
          title="취소(Esc)"
          onClick={onCancel}
          className="text-text-faint hover:bg-bg-soft rounded p-1 transition"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * 상태 칸 — 더블클릭 → 4단계 중 하나(칸반 드롭과 같은 대표값·잠금). 반 배정된 행은 고르면 이유를 띄우고 그대로
 * 둔다(칸반이 드롭을 거절하는 것과 같다 — `disabled`로 막으면 무반응이 고장으로 읽힌다).
 */
export function EditableStatusCell({
  row,
  canEdit,
}: {
  row: { id: string; outcome: string; assignedClassCount: number };
  canEdit: boolean;
}) {
  const cell = useCellEdit(`consultation:${row.id}`, row.outcome, async (nextOutcome) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("outcome", nextOutcome);
    const r = await setEnrollmentOutcome(undefined, fd);
    return r?.error ? { error: r.error } : { ok: true };
  });
  const chosen = useRef(false);
  const card = { outcome: cell.shown, assignedClassCount: row.assignedClassCount };
  const status = statusCellOf(card);
  if (cell.editing) {
    const nowStage = stageOfCard(card);
    return (
      <div data-no-drag-scroll>
        <SearchableSelect
          defaultOpen
          compact
          options={BOARD_STAGE_OPTIONS}
          value={nowStage}
          triggerClassName={SELECT_TRIGGER}
          onValueChange={(v) => {
            chosen.current = true;
            const target = v as BoardStageKey;
            if (target === nowStage) {
              cell.close();
              return;
            }
            const reason = dropBlockReason(card, target);
            if (reason) {
              toast.error(reason);
              cell.close();
              return;
            }
            cell.save(outcomeForDrop(target, cell.shown));
          }}
          onOpenChange={(o) => {
            if (!o && !chosen.current) cell.close();
          }}
        />
      </div>
    );
  }
  // 열 때 '골랐다' 표식을 지운다(렌더 중 ref 쓰기 금지 — 이벤트 안에서만).
  const openFresh = () => {
    chosen.current = false;
    cell.open();
  };
  return (
    <CellFace canEdit={canEdit} onOpen={openFresh} empty={false}>
      <Pill color={status.color} soft={false} className="w-full">
        {status.label}
      </Pill>
    </CellFace>
  );
}
