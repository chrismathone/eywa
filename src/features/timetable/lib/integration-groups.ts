// 통합뷰 커스텀 그룹 — 학원설정(과목별)에서 화면·엑셀·시트가 **같은 값**을 읽게 하는 단일 해석기.
// ⚠️ server-only 금지 — 클라(설정 편집기)도 타입·기본값을 쓴다. 순수 함수만 둔다([[#61]]).
import type { SubjectSetting } from "@/features/owner/settings-types";
import type { IntegrationGroupsConfig } from "./class-grid";

/** '기타' 섹션 기본 제목 — 설정이 비었을 때 화면·시트가 같은 말을 하도록 한 곳에서만 정한다. */
export const DEFAULT_OTHERS_TITLE = "기타 수업";

/**
 * 과목 설정 → 통합뷰 그룹 설정. **끄면 null**(= "N교시 시작" 자동 그룹).
 *
 * 스위치를 따로 둔 이유: 그룹 정의를 지우지 않고도 자동 그룹으로 되돌릴 수 있어야 한다
 * (껐다 켤 때마다 배치를 다시 만들게 하면 아무도 안 쓴다).
 * `showOthers` 기본값이 true인 이유: 어느 그룹에도 안 넣은 반이 **조용히 사라지면** 시간표가
 * 거짓말을 한다(원장은 "그 반이 없어진 줄" 안다). 숨김은 명시적으로 끌 때만.
 */
export function resolveIntegrationGroups(subject: SubjectSetting | undefined): IntegrationGroupsConfig | null {
  if (!subject?.integrationGroupsEnabled) return null;
  const groups = (subject.integrationGroups ?? []).filter((g) => g.title.trim());
  if (!groups.length) return null;
  return {
    groups: groups.map((g) => ({ id: g.id, title: g.title, classIds: g.classIds ?? [] })),
    showOthers: subject.integrationShowOthers !== false,
    othersTitle: subject.integrationOthersTitle?.trim() || DEFAULT_OTHERS_TITLE,
  };
}
