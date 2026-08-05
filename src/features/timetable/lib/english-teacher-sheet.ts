// 인재원 "강사별영어시간표(7월)" 시트 미러 — 강사뷰(teacher-major)의 컬럼 순서·헤더색 단일 소스.
// 슬롯 강사 라벨(slot_teacher_label = 시트의 강사 약칭) → { order, color }.
// ⚠️ 이건 학원설정 운영 enum이 아니라 **외부 시트의 표현 데이터를 그대로 옮긴 것**(강사 물리 배치 순서·색).
//    일부 강사(Elsa·Anna·Dom·부원장 등)와 자리 2개(JJ·LAB)는 DB 색이 없어, 그 폴백으로 쓴다.
//    → 강사가 직원 등록되고 users.bg_color가 채워지면 getTeacherColorMap(DB)이 우선하고 이 맵은 미등록분만 커버.
//    출처: scripts/_english_sync/read-teacher-grid.cjs 로 시트 강사 헤더 병합·배경색 실측(2026-07-04).
//    갱신하려면 그 스크립트를 재실행해 teacher_grid_blocks.json 대조.

import { isSpecialSlotLabel } from "./teacher-label";

export type SheetTeacherMeta = { order: number; color: string };

/** 시트 좌→우 강사 블록 순서 + 헤더 배경색(예비1~4 빈 블록 제외). key = slot_teacher_label. */
export const ENGLISH_SHEET_TEACHERS: Record<string, SheetTeacherMeta> = {
  Jane: { order: 1, color: "#dd7e6b" },
  Hannah: { order: 2, color: "#f9b3d1" },
  Elsa: { order: 3, color: "#674ea7" },
  Charlie: { order: 4, color: "#f6b26b" },
  부원장: { order: 5, color: "#d9ead3" },
  Dom: { order: 6, color: "#76a5af" },
  Anna: { order: 7, color: "#4285f4" },
  Florence: { order: 8, color: "#cc0000" },
  Kristine: { order: 9, color: "#a4c2f4" },
  Sam: { order: 10, color: "#ffc000" },
  // ⚠️ 마지막 두 열은 **사람이 아니라 자리**다(teacher-label.ts `SPECIAL_SLOT_LABELS`) — 열 순서·색·표기
  //    전부 시트 그대로다. 두 열은 다른 방(JJ=305 · LAB=603)이라 **합치지 않는다**(원장 2026-07-30 "JJ는 그대로").
  //    key = 해석된 라벨. 시트 원문 `이주희` 블록이 `LAB`으로 해석돼 이 키에 붙는다.
  JJ: { order: 11, color: "#bdbdbd" }, // 305호
  LAB: { order: 12, color: "#fff2cc" }, // 603호(시트에선 이주희 블록)
};

/** 강사 라벨 정렬 비교 — 시트 순서 우선, 시트 밖 강사는 뒤(이름순). */
export function compareSheetTeachers(a: string, b: string): number {
  const oa = ENGLISH_SHEET_TEACHERS[a]?.order ?? Number.MAX_SAFE_INTEGER;
  const ob = ENGLISH_SHEET_TEACHERS[b]?.order ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  return a.localeCompare(b, "ko");
}

/**
 * 강사뷰 컬럼 정렬 비교를 만든다 — **학원설정 순서 > 자리 뒤로 > 시트 미러 > 이름순**.
 *
 * 🔴 왜 설정이 필요한가: 위 시트 미러는 key가 **닉네임**(Jane·Hannah…)인데 2026-07-27부터 라벨이 한글
 * 이름으로 해석되면서 10명이 통째로 "시트 밖"으로 떨어져 **가나다순**이 됐다(부원장·JJ·LAB만 순서 유지).
 * 하드코딩 미러를 계속 고치는 대신 사람이 정하게 한다(운영 배치는 학원마다·달마다 바뀐다).
 *
 * ⚠️ **자리(JJ·LAB)는 기본이 최우측**(원장 2026-08-04). 사람이 아니라 방이라 강사 목록 사이에 끼면
 *    읽는 사람이 사람으로 오해한다. 단 설정에서 **명시적으로 순서를 주면 그 자리를 따른다**(예외 허용).
 */
export function buildTeacherComparator(order?: readonly string[]): (a: string, b: string) => number {
  const explicit = new Map((order ?? []).map((n, i) => [n, i]));
  const rank = (n: string): [number, number] => {
    const i = explicit.get(n);
    if (i !== undefined) return [0, i]; // ① 설정이 정한 순서
    if (isSpecialSlotLabel(n)) return [2, ENGLISH_SHEET_TEACHERS[n]?.order ?? 0]; // ③ 자리는 맨 뒤
    return [1, ENGLISH_SHEET_TEACHERS[n]?.order ?? Number.MAX_SAFE_INTEGER]; // ② 사람
  };
  return (a, b) => {
    const [ba, ia] = rank(a);
    const [bb, ib] = rank(b);
    if (ba !== bb) return ba - bb;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, "ko");
  };
}
