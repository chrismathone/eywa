/**
 * 자리 출석부 공개 PIN을 **읽기 전용 열람자에게 내려보내지 않기** — 순수(Vitest). 2026-10-03 운영점검 합의 A15.
 *
 * 운영 설정 화면은 두 면(운영 체계 · 과목 운영)이 **운영 섹션 전체**를 클라이언트로 넘긴다 — 컴포넌트 prop과,
 * 섹션 폼의 숨은 입력(JSON)으로. 화면의 칸만 가려도 값은 그 두 곳에 그대로 실려 있었다. 읽기 전용 열람자는
 * 저장을 못 하므로 값을 받을 이유가 없다: 서버가 **렌더 전에** 값을 지우고 '설정됨 / 꺼짐'만 따로 내려보낸다.
 *
 * 🔴 지우는 판정 = **운영 설정을 저장할 수 있는가**(`canWriteTenant(…, "operations_settings")`) — 저장 액션
 *    (`saveOwnerSection`)이 쓰는 것과 같은 함수·같은 키다. 그래서 값을 지운 payload를 받은 사람은 저장 권한이 없고,
 *    지운 payload가 저장될 길이 없다. 편집자는 종전처럼 실제 값을 받는다(다른 운영 항목만 고쳐 저장해도 PIN이 보존된다).
 * 🔴 지운 자리에 넣는 값은 **스키마가 받지 않는 길이**(13자 > `max(12)`)다 — 권한이 렌더와 저장 사이에 바뀌는 등
 *    어떤 경로로 이 payload가 저장 액션에 닿아도 검증에서 떨어진다. 빈 문자열을 넣으면 그 순간 두 자리의 공개 접속이
 *    조용히 꺼진다(빈 값 = 그 자리 끄기가 정식 의미다). 저장 스키마는 바꾸지 않았다.
 * ⚠️ 이 모듈은 서버(학원 설정 페이지)에서만 쓴다 — 클라이언트 컴포넌트는 `readOnly`와 `SeatPinStatus`만 받는다.
 * ⚠️ 해시 저장·재인증·PIN 교체 흐름은 이번 범위가 아니다(공개 자리 접속·시도 제한은 그대로).
 */
import type { OperationsSettings } from "./settings-types";

/** 값 대신 내려가는 표식 — 화면에 그리지 않는다. 스키마 상한(12자)보다 길어 저장 검증을 통과하지 못한다. */
export const REDACTED_SEAT_PIN = "\u2022".repeat(13);

/** 자리별 공개 접속이 켜져 있는가(값 없이). `configuredSeatPin`과 같은 판정 — 앞뒤 공백을 뺀 값이 비면 꺼짐. */
export type SeatPinStatus = { lab: boolean; jj: boolean };

const isSet = (raw: string | null | undefined) => (raw ?? "").normalize("NFKC").trim().length > 0;

export function seatPinStatus(operations: Pick<OperationsSettings, "seatPins">): SeatPinStatus {
  return { lab: isSet(operations.seatPins?.lab), jj: isSet(operations.seatPins?.jj) };
}

/** 운영 설정에서 자리 PIN 값만 지운 사본(다른 칸은 그대로). 원본은 건드리지 않는다. */
export function redactSeatPins(operations: OperationsSettings): OperationsSettings {
  return { ...operations, seatPins: { lab: REDACTED_SEAT_PIN, jj: REDACTED_SEAT_PIN } };
}

/** 클라이언트로 내려보낼 운영 설정 — 편집자는 그대로, 읽기 전용 열람자는 PIN을 지운 사본. */
export function operationsForViewer(operations: OperationsSettings, canEdit: boolean): OperationsSettings {
  return canEdit ? operations : redactSeatPins(operations);
}
