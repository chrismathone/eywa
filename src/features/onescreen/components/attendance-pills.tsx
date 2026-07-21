"use client";

/**
 * 출결 인라인 pill(2단계) — 출석/지각/결석 1클릭, 출석부(attendance_records)와 같은 기록에 저장.
 * - 활성 pill 재클릭 = no-op(삭제 아님 — 기록 지우기는 출석부에서만: status=null 삭제가 메모·시수까지 지움).
 * - raw가 3종 외(조퇴/공결/보강)면 pill 대신 한글 배지 — 축약값 되쓰기로 raw를 파괴하지 않게, 변경은 출석부에서.
 * - pending(in-flight) 동안 잠금 — 연속 클릭 응답 역전 방지.
 * (출결 status는 코드 고정 enum(운영 enum 아님) — 라벨 맵은 출석부 UI와 동일 관례.)
 */
export type BasicAttendance = "present" | "late" | "absent";
const BASIC: readonly BasicAttendance[] = ["present", "late", "absent"];
const LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};
const ON_CLS: Record<BasicAttendance, string> = {
  present: "bg-primary text-primary-foreground",
  late: "bg-amber text-white",
  absent: "bg-danger text-white",
};

export function AttendancePills({
  value,
  pending,
  onSet,
  studentName,
  readOnly,
}: {
  value: string | null | undefined; // raw status(null=기록 없음)
  pending: boolean; // 이 (학생×반) 저장 중 — 잠금
  onSet: (status: BasicAttendance) => void;
  studentName: string;
  /** 출결 쓰기 권한 없음(학원설정 역할·권한) — 누를 수 있는 것처럼 보이지 않게 표시만 한다. */
  readOnly?: boolean;
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
    <span className="inline-flex gap-0.5" role="group" aria-label={`${studentName} 출결`}>
      {BASIC.map((s) => {
        const on = value === s;
        return (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => {
              if (!on) onSet(s); // 재클릭 no-op
            }}
            aria-pressed={on}
            title={on ? `${LABEL[s]} (기록 지우기는 출석부에서)` : `${LABEL[s]}로 기록`}
            className={`rounded-pill px-1.5 py-px text-[10px] font-bold transition disabled:opacity-50 ${
              on ? ON_CLS[s] : "border-line text-text-faint hover:bg-bg-soft hover:text-text-dim border"
            }`}
          >
            {LABEL[s]}
          </button>
        );
      })}
    </span>
  );
}
