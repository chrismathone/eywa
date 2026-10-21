/**
 * 학원 설정 '대시보드 관리'의 **실데이터 미리보기** — 원장 시점 원본 스냅샷(`loadOverview({ full: true })`)을 편집 중인 역할로 다듬는다.
 * 순수 함수. 서버가 그 역할 계정에 하는 일을 **같은 함수로** 되풀이한다:
 *  ① 그 역할이 메뉴 권한으로 못 읽는 영역은 지운다(서버는 애초에 조회하지 않는다 — `add()`의 menus) ·
 *  ② 배치 해석(`resolveView` — 권한 상한·머리줄 정리) · ③ 값 정리(`shapeSections` — 금액·전화번호·담당 과목).
 * ⚠️ 원본이 원장 시점이라 '행정·자산'의 내 결재 대기·공지 대상 같은 **보는 사람 기준** 값은 실제 그 역할 화면과 조금 다를 수 있다.
 */
import type { MenuKey } from "@/lib/permissions";
import type { Area, OverviewSnapshot, Sections } from "@/features/dashboard/overview/model";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { defaultItems } from "./defaults";
import { sameItems } from "./engine";
import { AREA_MENUS } from "./registry";
import { shapeSections } from "./shape";
import { sliceGroupOf } from "./slices";
import { DASHBOARD_VERSION, EMPTY_DASHBOARD, type Bundle, type Item } from "./types";
import { resolveView } from "./view";

export function previewSnapshot(
  full: OverviewSnapshot,
  input: { role: Bundle; items: readonly Item[]; menus: ReadonlySet<MenuKey>; subject: { key: string; label: string } | null },
): OverviewSnapshot {
  const { role, items, menus, subject } = input;
  // 기본과 같으면 저장값이 없는 것과 같다(원장 기본 = 옛 격자) — 서버가 저장할 때 지우는 규칙과 같다.
  const stored = sameItems(items, defaultItems(role)) ? EMPTY_DASHBOARD : { version: DASHBOARD_VERSION, layouts: [{ role, items: [...items] }] };
  const view = resolveView({ stored, bundle: role, menus, subjectLabels: role === "subject" && subject ? [subject.label] : [] });
  const readable = Object.fromEntries(
    Object.entries(full.sections).filter(([area]) => AREA_MENUS[area as Area]?.every((m) => menus.has(m))),
  ) as Sections;
  const programSubjects = programSubjectsOf(full.subjects);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programSubjects);
  const group = role === "subject" && subject ? groupOf(subject.key) : null;
  // 행 좁히기의 과목 판정은 서버와 같은 `sliceGroupOf`(설정에 없는 과목·빈 과목 = 모두에게) — 과목 목록도 서버와 같은 설정 과목만.
  const keys = full.sliceSubjectKeys ? new Set(full.sliceSubjectKeys) : null;
  const sliceSubjects = keys ? programSubjects.filter((s) => keys.has(s.key)) : programSubjects;
  const sections = shapeSections(readable, view, { groups: group ? [group] : [], groupOf: sliceGroupOf(sliceSubjects, groupOf), slices: full.slices });
  return {
    ...full,
    // 원본을 다시 받으면(저장 뒤 등) 쿼리 캐시가 옛 미리보기를 붙들지 않게 받은 시각을 섞는다.
    scope: `${full.scope}:${full.requestedAt}:preview:${role}:${view.rev}:${subject?.key ?? ""}`,
    allowed: full.allowed.filter((m) => menus.has(m)),
    view,
    sections,
  };
}

/**
 * 과목 관리자 미리보기의 과목 선택지 — 운영실이 쓰는 묶음(영어 = EiE·인재원 영어, 수학 = 수학(심화) 포함)마다 하나.
 * 🔴 묶음의 대표 키 = 묶음 이름과 같은 키(`math`·`english`)가 있으면 그것 — 순서로 고르면 옛 라벨이 앞에 붙은 표(`subjectLabelRecord`)에서
 *    수학 묶음이 `highmath`로 잡혀, 편집기가 `math`로 저장한 수학 배치를 운영실이 못 찾고 공통 배치로 떨어졌다(원장 제보 2026-10-21).
 */
export function subjectChoices(subjects: Readonly<Record<string, string>>): { key: string; label: string }[] {
  const programSubjects = programSubjectsOf(subjects);
  const at = new Map<string, number>();
  const out: { key: string; label: string }[] = [];
  for (const { key, label } of programSubjects) {
    const group = subjectGroupOf(key, programSubjects);
    if (!group) continue;
    const i = at.get(group);
    if (i === undefined) {
      at.set(group, out.length);
      out.push({ key, label });
    } else if (key === group && out[i]!.key !== group) out[i] = { key, label };
  }
  return out;
}
