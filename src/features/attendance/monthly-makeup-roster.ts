/**
 * 월별 출석부 명단에 **수강행 없는 기록자**를 합친다 — 순수 규약(Vitest).
 *
 * 원장 제보(2026-09-02): *"김은정 선생님의 이윤 학생이 9/1 자 출석부에 나와야하는데 목록에도 안보이네."*
 * 보이지 않는 '보강' 반(0241a)은 **일부러 수강행을 안 만드는 반**인데, 월별 매트릭스는 명단을
 * `enrollments`에서만 만들어 그 반이 **항상 0명**이었다(에러도 안 난다). 같은 뿌리로 정규 반에서도
 * "수강생이 아닌데 그날 기록이 있는 학생"(반 보강 등)이 **월별 표에서만** 사라지고 있었다
 * (실측 최근 90일: (반,학생) 10쌍 · 출결 13행 — 기록은 있고 시수도 세는데 장부에만 안 보였다).
 *
 * 🔴 판정은 일별 입력 로스터와 **같은 함수**(`makeupStudentIds`)다 — 두 화면이 같은 집합을 말해야 한다.
 *    여기서 규칙을 다시 적지 말 것(가드가 그 함수를 실제로 부르는지 동작으로 본다).
 * 🔴 합친 행의 `spans`는 **일부러 빈 배열**이다 — `isEnrolledOn`은 구간이 없으면 true를 돌려주므로
 *    칸이 회색으로 죽지 않는다(그 함수 주석: *"모르는 걸 '재원 아님'으로 칠하면 표 전체가 회색이 되고,
 *    그건 사실이 아니라 자료 없음이다"*). **가짜 수강 구간을 지어내지 말 것.**
 * 🔴 `attendDows`도 빈 배열 — 정규 등원일이 없다. 그래서 기록이 있는 **그 하루만** 칸에 값이 서고
 *    나머지는 빈칸이다 = 원장이 말한 *"그날만 출석한것처럼"*.
 * ⚠️ 호출 순서: `attachLifecycleBadges` **뒤**에 합칠 것 — 수강 구간이 없는 학생에게 신입/퇴원 뱃지를
 *    계산시키면 거짓 표식이 붙는다. 그리고 출결 조회(`studentIds`)는 합친 **뒤**여야 칸이 찬다.
 */
import { makeupStudentIds } from "./input-roster";
import type { EnrollSpan, LifecycleBadge } from "./enrollment-span";

/** `students`에서 받아 오는 최소 모양(이름·학년·학교). */
export type RecordedOnlyStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
};

/** 합친 행의 모양 — `MatrixStudent`와 구조적으로 호환(서버 타입을 여기서 import하지 않는다). */
export type RecordedOnlyMatrixRow = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolledAt: null;
  attendDows: number[];
  spans: EnrollSpan[];
  badges: LifecycleBadge[];
};

/**
 * 그 반·그 기간에 **기록은 있는데 수강행이 없는** 학생 id(중복 제거, 기록 순서 유지).
 * @param enrolledStudentIds 그 반 수강행의 학생 id **전부**(휴원·종료 포함 — 일별 로스터와 같은 집합).
 */
export function recordedOnlyStudentIds(
  recordedStudentIds: readonly string[],
  enrolledStudentIds: readonly string[],
): string[] {
  return makeupStudentIds(recordedStudentIds, enrolledStudentIds);
}

/** 합친 행 하나 — 구간·등원일·뱃지가 **전부 빈** 이유는 파일 머리 주석. */
export function recordedOnlyMatrixRow(s: RecordedOnlyStudent): RecordedOnlyMatrixRow {
  return {
    id: s.id,
    name: s.name,
    grade: s.grade,
    school: s.school,
    enrolledAt: null,
    attendDows: [],
    spans: [],
    badges: [],
  };
}
