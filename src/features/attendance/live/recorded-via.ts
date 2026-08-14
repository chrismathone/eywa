/**
 * 출결을 **누가 넣었는지** — 쓰는 순간에 굳히는 값(순수).
 *
 * 역할은 변한다(강사가 데스크로 승격·그 반대). 자리 출석부의 `seat_label`이 같은 이유로
 * 컬럼에 굳어 있듯, 입력 주체도 저장 시점의 사실로 남긴다.
 *
 * 빈 값 = 이 컬럼이 생기기 전 기록이거나, 아직 못 채운 경로(ECS RPC 등). 거짓말은 하지 않는다.
 */
export const RECORDED_VIAS = ["teacher", "desk", "seat", "kiosk"] as const;
export type RecordedVia = (typeof RECORDED_VIAS)[number];

export const RECORDED_VIA_LABEL: Record<RecordedVia, string> = {
  teacher: "강사",
  desk: "데스크",
  seat: "자리",
  kiosk: "키오스크",
};

export function isRecordedVia(v: string | null | undefined): v is RecordedVia {
  return !!v && (RECORDED_VIAS as readonly string[]).includes(v);
}

/**
 * 이 쓰기 주체는 강사인가 데스크인가.
 * · 그 반을 가르치는 사람(담임·부담임·위임) = 강사 — 10분 제한 없음
 * · 전 학원 쓰기 권한인데 그 반 담당이 아님 = 데스크
 */
export function resolveStaffVia(teachesClass: boolean): RecordedVia {
  return teachesClass ? "teacher" : "desk";
}
