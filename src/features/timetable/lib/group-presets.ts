// 통합뷰 그룹 배치 **보관함(프리셋)** 의 순수 상태 전이 — "여러 벌을 이름 붙여 두고 골라 불러온다".
// ⚠️ `import "server-only"` 금지 — 클라 편집기가 쓴다([[#61]]). IO·id 생성 없이 순수 함수만(Vitest로 잠근다).
//
// 설계 결정: 프리셋은 **보관함**이지 '현재'와 링크된 게 아니다. 불러오기 = 내용을 현재 배치로 **복사**.
// 링크로 묶으면 프리셋을 고른 뒤의 임시 수정이 보관본까지 오염시켜, "학기 배치"를 잠깐 손댔다가
// 영영 잃는다. 덮어쓰려면 같은 이름으로 다시 저장하면 된다(아래 upsertPreset).

import type { GroupDraft } from "./group-assign";

/**
 * 과목당 보관 가능한 배치 수 — **스키마와 화면이 같은 값을 본다.**
 * ⚠️ 여기(순수 모듈)에 두는 이유: 화면(클라 컴포넌트)이 이 값을 읽는데, zod가 있는 settings-types에
 *    두면 그걸 import하는 순간 **zod가 시간표 클라 번들에 딸려 온다**(B5 정신). 스키마 쪽이 이걸 읽는다.
 * (넘치면 저장이 zod에서 거부되는데 그 에러는 영문 경로가 섞인 원문이라 화면에 그대로 못 내보낸다
 *  = 화면에서 먼저 막아야 한다.)
 */
export const MAX_GROUP_PRESETS = 12;

export type GroupPreset = {
  id: string;
  name: string;
  groups: GroupDraft[];
  /** 저장 당시의 '기타' 표시 여부·제목 — 배치는 이 둘까지 같아야 화면이 똑같이 재현된다. */
  showOthers: boolean;
  othersTitle: string;
  /** 누가 저장했나(표시용). **서버가 찍는다** — 클라 값은 무시된다(위조 방지). 옛 저장분은 없음. */
  savedBy?: string;
  /** 언제 저장했나(ISO, UTC). 표시는 Asia/Seoul. 서버가 찍는다. */
  savedAt?: string;
};

/** 현재 편집 중인 배치 = 프리셋 1벌로 얼릴 재료(이름·id는 호출부가 정한다 — id 생성은 순수하지 않다). */
export type PresetBody = Omit<GroupPreset, "id" | "name" | "savedBy" | "savedAt">;

/**
 * 같은 이름이면 **덮어쓴다**(자리 유지), 없으면 뒤에 붙인다.
 *
 * 왜 이름 기준인가: 목록에서 사람이 고르는 키가 이름이라 같은 이름이 둘이면 어느 쪽을 부른 건지
 * 알 수 없다("학기 배치"가 두 개 = 사실상 고장). 덮어쓸 때 **id는 유지**해서, 다른 화면이 id로
 * 가리키고 있어도 안 끊긴다. 이름은 trim해 비교한다(" 학기 " ≠ "학기"로 갈리는 유령 중복 방지).
 */
export function upsertPreset(presets: GroupPreset[], next: GroupPreset): GroupPreset[] {
  const name = next.name.trim();
  const at = presets.findIndex((p) => p.name.trim() === name);
  const merged = { ...next, name };
  if (at < 0) return [...presets, merged];
  return presets.map((p, i) => (i === at ? { ...merged, id: p.id } : p));
}

/** 보관함에서 1벌 제거. 없는 id면 원본 그대로(무동작). */
export function removePreset(presets: GroupPreset[], id: string): GroupPreset[] {
  return presets.some((p) => p.id === id) ? presets.filter((p) => p.id !== id) : presets;
}

/** 프리셋 이름 바꾸기 — 빈 이름·다른 프리셋과 겹치는 이름은 거부(무동작). */
export function renamePreset(presets: GroupPreset[], id: string, name: string): GroupPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return presets;
  if (presets.some((p) => p.id !== id && p.name.trim() === trimmed)) return presets;
  return presets.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
}

/**
 * 불러오기 — 프리셋 내용을 **깊은 복사**해서 현재 배치로 준다.
 *
 * 🔴 얕게 주면 안 되는 이유: 편집기가 `classIds` 배열을 그대로 들고 드래그로 밀어넣기 시작하면
 * 보관함 안의 그 배열이 같이 바뀐다(불러온 뒤 한 번 끌면 원본 프리셋이 오염 = 되돌릴 곳이 사라짐).
 */
export function loadPreset(preset: GroupPreset): PresetBody {
  return {
    groups: preset.groups.map((g) => ({ ...g, classIds: [...g.classIds] })),
    showOthers: preset.showOthers,
    othersTitle: preset.othersTitle,
  };
}

/** 저장된 설정(부분값·구버전)을 화면이 바로 쓰는 완전한 프리셋으로 — 기본값은 '기타 보여줌'. */
export function normalizePresets(
  raw: {
    id: string;
    name: string;
    groups?: { id: string; title: string; classIds?: string[] }[];
    showOthers?: boolean;
    othersTitle?: string;
    savedBy?: string;
    savedAt?: string;
  }[] = [],
  fallbackOthersTitle = "",
): GroupPreset[] {
  return raw.map((p) => ({
    id: p.id,
    name: p.name,
    groups: (p.groups ?? []).map((g) => ({ id: g.id, title: g.title, classIds: [...(g.classIds ?? [])] })),
    showOthers: p.showOthers !== false,
    othersTitle: p.othersTitle ?? fallbackOthersTitle,
    savedBy: p.savedBy,
    savedAt: p.savedAt,
  }));
}
