"use client";

/**
 * 오늘 보드 **출결 알약** — 드롭다운 배제(원장 2026-08-11 *"일일이 드랍다운하면 힘드니까"* →
 * *"드랍다운 배제시켜라"*). 열고 → 고르고 → 닫히는 3동작 대신 **1클릭**이다.
 *
 * 문법은 원스크린 [AttendancePills](../../onescreen/components/attendance-pills.tsx)를 따르되(1클릭 ·
 * 지각/결석은 사유 창을 거쳐 저장 · 활성 라벨 hover로 사유 수정), ECS 계약 두 가지가 다르다:
 *  · **활성 '출석' 재클릭 = 취소** — ECS에는 안전한 취소 경로(0169a `clearPresentAttendance`,
 *    plain present만 삭제·손댄 기록은 서버가 거절)가 있으므로 주간 시트 체크와 같은 제스처를 연다.
 *    원스크린 알약이 재클릭 no-op인 건 그쪽에 이 경로가 없어서다.
 *  · 시수 없음 — 사유·시수 편집은 출석부·주간 시트 몫(오늘 보드 §E 규약 그대로).
 *
 * ⚠️ **주간 시트의 드롭다운([attendance-select.tsx](./attendance-select.tsx))은 유지** — 그쪽은 원장
 *    2026-08-06 지시(*"출결도 드랍다운으로"* — 표 칸 폭·행 높이 사정)라 화면마다 지시가 다르다.
 *    이 알약을 주간 시트로 가져가거나 이 화면을 드롭다운으로 되돌리지 말 것.
 * ⚠️ 3종 밖 상태(조퇴·공결·보강)는 표시만 — 축약 되쓰기로 raw를 파괴하지 않는다(두 컨트롤 공통 계약).
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { NoteForm } from "@/features/onescreen/components/attendance-pills";
import type { BasicAttendance } from "./attendance-select";

const BASIC: readonly BasicAttendance[] = ["present", "late", "absent"];
/** 사유를 받는 상태 — 알약·드롭다운 공통 계약(지각·결석). 출석은 즉시 저장. */
const NEEDS_NOTE: ReadonlySet<string> = new Set(["late", "absent"]);
const LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};
/** 활성색 — 원스크린 알약과 동일(출석=primary·지각=amber·결석=danger). */
const ON_CLS: Record<BasicAttendance, string> = {
  present: "bg-primary text-primary-foreground",
  late: "bg-amber text-white",
  absent: "bg-danger text-white",
};

const READONLY_CLS = "bg-bg-soft text-text-dim rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap";

export function TodayAttendancePills({
  status,
  note,
  studentName,
  canMark,
  onSet,
  onClear,
}: {
  status: string | null;
  /** 사유 메모 — 지각·결석 창의 초기값(점 표시로도 쓴다). */
  note: string | null;
  studentName: string;
  canMark: boolean;
  onSet: (status: BasicAttendance, note?: string | null) => void;
  /** 활성 '출석' 재클릭 — plain present만 지워진다(그 외는 서버가 거절하고 사유를 띄운다). */
  onClear: () => void;
}) {
  // 권한·기간이 없으면 누를 수 있는 것처럼 그리지 않는다(드롭다운·원스크린과 같은 처방).
  if (!canMark) {
    return (
      <span
        className={READONLY_CLS}
        title={
          note
            ? `${status ? (LABEL[status] ?? status) : "출결 없음"} · ${note} — 출결 입력 권한이 없거나 수정 기간이 지났습니다`
            : "출결 입력 권한이 없거나 수정 기간이 지났습니다"
        }
      >
        {status ? (LABEL[status] ?? status) : "출결 —"}
      </span>
    );
  }
  if (status && !BASIC.includes(status as BasicAttendance)) {
    return (
      <span className={READONLY_CLS} title="조퇴·공결·보강은 출석부에서 변경하세요(여기서 바꾸면 그 상태가 사라집니다)">
        {LABEL[status] ?? status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5" role="group" aria-label={`${studentName} 출결`}>
      {BASIC.map((s) => (
        <Pill
          key={s}
          status={s}
          active={status === s}
          note={note ?? ""}
          studentName={studentName}
          onSet={onSet}
          onClear={onClear}
        />
      ))}
    </span>
  );
}

/** 알약 1개 — 지각·결석은 사유 창을 거쳐 저장, 활성 라벨은 hover·재클릭으로 사유 수정(원스크린과 동일). */
function Pill({
  status,
  active,
  note,
  studentName,
  onSet,
  onClear,
}: {
  status: BasicAttendance;
  active: boolean;
  note: string;
  studentName: string;
  onSet: (status: BasicAttendance, note?: string | null) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const asks = NEEDS_NOTE.has(status);

  const pill = (
    <button
      type="button"
      onClick={() => {
        if (asks) return setOpen(true); // 활성 재클릭도 '사유 수정'으로(상태는 창에서 저장할 때 확정)
        if (active) return onClear(); // ECS 제스처: 같은 체크를 다시 눌러 되돌린다(0169a)
        onSet(status);
      }}
      onMouseEnter={asks && active ? () => setOpen(true) : undefined}
      aria-pressed={active}
      title={
        asks
          ? active
            ? `${LABEL[status]} — 사유 메모 수정(기록 지우기는 출석부에서)`
            : `${LABEL[status]}로 기록 — 사유 메모를 적을 수 있습니다`
          : active
            ? "출석 취소 — 기록 없음으로 되돌립니다(사유·시수가 붙은 기록은 지워지지 않습니다)"
            : "출석으로 기록"
      }
      className={`cursor-pointer rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap transition ${
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
            {/* key=열 때마다 서버 값으로 다시 시작(남이 고친 사유가 반영되게) — 두 컨트롤 공통. */}
            <NoteForm
              key={note}
              initial={note}
              label={`${studentName} · ${LABEL[status]} 사유`}
              onCancel={() => setOpen(false)}
              onSave={(text) => {
                onSet(status, text.trim() || null);
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
