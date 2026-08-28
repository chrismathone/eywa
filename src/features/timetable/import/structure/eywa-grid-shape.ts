// 이 탭이 정말 **eywa export 형식**인가 — 가져오기 전에 확인하는 순수 검사.
//
// 🔴 왜 필요한가(원장 질문 2026-08-28 *"내가 9월을 그냥 우리 시트에 전체 붙여놓고 가져오기 누르면?"*):
// 원장님이 편집하는 **마스터 시트**와 eywa가 내보내는 시트는 행 배치가 다르다.
//   · eywa export … 1행=강사 라벨 · 2행=요일("월 8/24") · 3행+=데이터, A열=시각 `HH:MM`(24시간·0채움)
//   · 마스터      … 1행=블록번호 · 2행=강사 · 3행=근무메모 · 4행=요일 · 5행+=데이터, A열=`2:20~2:30`
//
// 그대로 붙여넣으면 요일을 하나도 못 찾아 "데이터 없음"으로 **안전하게** 실패한다. 문제는 행을 맞춰
// 붙였을 때다 — 마스터 2행(강사)엔 6열 병합이 실제로 있어서(실측 17개) 구조는 통과하는데, **A열 시각이
// 12시간제**라 앵커가 `2:20`→**02:20**으로 잡힌다. `parseEywaTeacherGrid`는 앵커에 10분씩 더해 나가므로
// **모든 수업이 12시간 앞으로** 들어간다. 에러도 안 나고 400슬롯이 말끔히 파싱된다 = 조용히 틀린 시간표.
//
// 그래서 파싱 결과가 아니라 **격자 모양**을 먼저 본다. 마스터 전용 파서(`parse-grid.ts`)는 라벨을 믿지 않고
// 14:20 앵커를 알고 있으므로, 마스터는 그쪽(스크립트/마스터 가져오기)으로 보내는 것이 정답이다.

import type { SheetGrid } from "./types";

/** eywa export가 A열에 쓰는 시각 표기 — `minToHM`가 항상 0을 채운 24시간제로 만든다. */
const EYWA_TIME = /^\d{2}:\d{2}$/;
/** 요일 헤더는 "월 8/24"처럼 요일로 시작한다(마스터도 같은 규칙이라 이건 구분점이 아니다). */
const DAY_HEAD = /^\s*[월화수목금토일]/;

const TEACHER_ROW = 0;
const DAY_ROW = 1;
const DATA_START_ROW = 2;

function cell(grid: SheetGrid, r: number, c: number): string {
  return (grid.cells[r]?.[c] ?? "").trim();
}

/**
 * eywa export 형식이 아니면 **한글 사유**를, 맞으면 `null`을 돌려준다.
 * ⚠️ 사유 문자열은 그대로 화면에 나간다 — raw enum·영문 원문을 섞지 말 것.
 */
export function checkEywaGridShape(grid: SheetGrid): string | null {
  // ⓪ 아예 빈 탭은 "형식이 다르다"가 아니라 "비었다"고 말해야 한다 — 시트를 아직 안 채운 경우가 대부분이다.
  if (!grid.cells.some((row) => row.some((v) => (v ?? "").trim() !== "")))
    return "탭에 데이터가 없습니다(시트를 확인하세요).";

  // ① 2행이 요일이어야 한다. 마스터를 통째로 붙이면 여기 강사 이름이 온다.
  const dayRow = grid.cells[DAY_ROW] ?? [];
  if (!dayRow.some((v) => DAY_HEAD.test((v ?? "").trim())))
    return "이 탭은 eywa 형식이 아닙니다 — 2행이 요일(월·화…)이어야 하는데 아닙니다. 마스터 시트를 붙여넣으셨다면 그대로는 가져올 수 없습니다.";

  // ② A열 시각이 24시간 `HH:MM`이어야 한다. 🔴 여기가 조용히 틀리는 자리다.
  //    데이터 첫 행이 비어 있을 수 있어 위에서부터 처음 값이 있는 행을 앵커로 본다(파서와 같은 열).
  let label: string | null = null;
  for (let r = DATA_START_ROW; r < grid.cells.length; r++) {
    const v = cell(grid, r, 0);
    if (v !== "") {
      label = v;
      break;
    }
  }
  if (label === null) return "이 탭의 A열에 시각이 없습니다 — eywa에서 내보낸 시트인지 확인하세요.";
  if (!EYWA_TIME.test(label))
    return `A열 시각이 eywa 형식이 아닙니다("${label}"). eywa 시트는 24시간 표기(예 14:20)를 씁니다 — 마스터 시트의 12시간 표기를 그대로 가져오면 모든 수업이 12시간 앞으로 들어갑니다.`;

  // ③ 1행에 강사 라벨이 하나라도 있어야 한다(A열 "시각" 코너 제외).
  const teacherRow = (grid.cells[TEACHER_ROW] ?? []).slice(1);
  if (!teacherRow.some((v) => (v ?? "").trim() !== ""))
    return "이 탭의 1행에 강사가 없습니다 — eywa에서 내보낸 시트인지 확인하세요.";

  return null;
}
