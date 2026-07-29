// 인재원 "강사별영어시간표(7월)" 시트 미러 — 강사뷰(teacher-major)의 컬럼 순서·헤더색 단일 소스.
// 슬롯 강사 라벨(slot_teacher_label = 시트의 강사 약칭) → { order, color }.
// ⚠️ 이건 학원설정 운영 enum이 아니라 **외부 시트의 표현 데이터를 그대로 옮긴 것**(강사 물리 배치 순서·색).
//    강사 6명(Elsa·Anna·Dom·JJ·부원장·이주희)이 아직 직원(users)으로 등록 안 돼 DB 색이 없어, 그 폴백으로 쓴다.
//    → 강사가 직원 등록되고 users.bg_color가 채워지면 getTeacherColorMap(DB)이 우선하고 이 맵은 미등록분만 커버.
//    출처: scripts/_english_sync/read-teacher-grid.cjs 로 시트 강사 헤더 병합·배경색 실측(2026-07-04).
//    갱신하려면 그 스크립트를 재실행해 teacher_grid_blocks.json 대조.

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
  // ⚠️ 마지막 두 열은 **사람이 아니라 자리**다(시트에선 JJ·이주희 블록) — 열 순서·색은 시트 그대로 두고
  //    이름만 자리명으로 바꿨다(teacher-label.ts `SPECIAL_SLOT_LABELS`, 원장 2026-07-29).
  집중자율수업실: { order: 11, color: "#bdbdbd" }, // 305호(구 JJ 블록)
  랩실: { order: 12, color: "#fff2cc" }, // 603호(구 이주희 블록)
};

/** 강사 라벨 정렬 비교 — 시트 순서 우선, 시트 밖 강사는 뒤(이름순). */
export function compareSheetTeachers(a: string, b: string): number {
  const oa = ENGLISH_SHEET_TEACHERS[a]?.order ?? Number.MAX_SAFE_INTEGER;
  const ob = ENGLISH_SHEET_TEACHERS[b]?.order ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  return a.localeCompare(b, "ko");
}
