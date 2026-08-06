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
import { FieldSelect } from "@/features/onescreen/components/field-select";

export type BasicAttendance = "present" | "late" | "absent";

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
  onSet: (status: BasicAttendance) => void;
  /** '선택 안 함' — plain present만 지워진다(그 외는 서버가 거절하고 사유를 띄운다). */
  onClear: () => void;
}) {
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
    <span title={note ? `${studentName} · ${label ?? ""} 사유: ${note} (수정은 출석부에서)` : undefined}>
      <FieldSelect
        options={OPTIONS}
        value={label}
        ariaLabel={`${studentName} 출결`}
        onSelect={(v) => {
          if (v === null) return onClear();
          const next = TO_STATUS[v];
          if (next && next !== status) onSet(next);
        }}
      />
      {/* 사유가 있으면 점 하나 — 열어보지 않아도 "사유가 적혀 있다"가 보인다(원스크린 알약과 같은 신호). */}
      {note ? (
        <span aria-hidden className="text-text-faint ml-0.5 align-middle text-[8px]">
          ●
        </span>
      ) : null}
    </span>
  );
}
