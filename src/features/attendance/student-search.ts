/**
 * 출석부 **학생 검색** — 판정 순수 함수(Vitest).
 *
 * 원장 지시 2026-08-19: *"월별출석부나 오늘출결에서 학생 검색하는 기능. 학생 검색하면 해당 수업만 남고
 * 나머지는 숨김처리하는 방식으로."* 반이 세로로 길게 이어져 "이 학생이 이번 달 어디어디 빠졌나"를
 * 보려면 반 이름을 훑어야 했다.
 *
 * 🔑 **두 화면(월별 출석부·오늘 출결)이 같은 함수를 쓴다.** 각자 구현하면 "월별에선 찾히는데 오늘
 *    출결에선 안 찾히는" 상태가 생기고, 그건 검색이 아니라 복불복이 된다.
 * 🔴 이 함수는 **화면에 이미 그려진 값**만 본다 — 학생 전체를 뒤지는 조회를 새로 붙이지 않는다
 *    (강사는 담당 반만 본다는 열람 범위를 검색이 뚫으면 안 된다, [[#77]]).
 * ⚠️ 초성 검색(ㄱㄷ)은 이번 범위가 아니다 — 넣게 되면 **이 파일 한 곳**만 고치면 두 화면이 함께 따라온다.
 */

/**
 * 비교용 정규화 — **공백 제거 + 소문자화**.
 *
 * 공백을 지우는 이유: 이름·학교 표기가 자리마다 다르다("김 하늘"·"경명여중 1"). 사람은 띄어쓰기를
 * 신경 쓰지 않고 친다.
 * ⚠️ 여기서 더 지우지 말 것(가운뎃점·괄호 등) — 표시값과 검색값이 멀어질수록 "왜 안 찾히지"가 늘어난다.
 */
export function normalizeSearchText(v: string): string {
  return v.replace(/\s+/g, "").toLowerCase();
}

/** 지금 필터가 걸려 있는가 — 공백만 친 것은 검색이 아니다(화면을 비우면 안 된다). */
export function isSearchActive(query: string): boolean {
  return normalizeSearchText(query).length > 0;
}

/**
 * 한 줄이 들고 있는 검색 대상 — **그 행에 실제로 그려진 것만** 넘긴다(이름·학교·학년·영문 이름 등).
 * null·undefined·빈 문자열은 그냥 건너뛴다(있는 것만 본다).
 */
export type StudentSearchFields = readonly (string | null | undefined)[];

/**
 * 이 줄이 검색어에 걸리나 — 필드 **하나라도** 부분 일치하면 통과.
 *
 * 🔴 검색어가 비어 있으면 **항상 참**이다. 필터가 없을 때 아무 줄도 안 그리는 사고를 구조적으로 막는다
 *    (호출부는 `isSearchActive`로 "지금 걸려 있나"를 따로 묻는다).
 */
export function matchesStudentSearch(query: string, fields: StudentSearchFields): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  for (const f of fields) {
    if (!f) continue;
    if (normalizeSearchText(f).includes(q)) return true;
  }
  return false;
}

/**
 * 결과가 0명일 때 화면이 내놓을 한 줄 — **왜 비었는지**를 사람 말로 밝힌다(raw 코드 금지).
 * 빈 표에 "—"만 두면 "출석부가 고장났다"로 읽힌다.
 */
export function emptySearchMessage(query: string, where: string): string {
  return `‘${query.trim()}’과 맞는 학생이 ${where}에 없습니다 — 검색어를 지우면 전체가 다시 보입니다.`;
}
