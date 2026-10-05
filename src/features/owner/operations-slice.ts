/**
 * 운영 섹션(`operations`)을 **쓰는 쪽마다 제 몫만** 얹기 위한 순수 규칙 — 서버 저장·화면 token이 함께 쓴다.
 *
 * 🔴 왜 있나: 운영 섹션은 쓰는 곳이 여럿이다(운영 체계 면 · 과목 운영 면 · 시간표의 강사 순서/통합뷰 그룹 ·
 *    예약 그룹 cron · 영어 시트 반영). 예전엔 화면이 연 시점의 섹션 **전체**를 되돌려 보냈고 서버는 통째로
 *    갈아끼웠다 — 창을 열어 둔 사이 다른 곳에서 한 저장이 조용히 옛 값으로 되돌아갔다.
 *    이제 모든 저장은 **방금 읽은 값(fresh) 위에 그 요청이 맡은 칸만** 얹는다.
 * ⚠️ 새 운영 칸을 스키마에 더하면 어느 면이 맡는지 여기서 정한다(가드 `operations-slice.test.ts`).
 */
import { z } from "zod";
import { operationsSchema, subjectSchema, type OperationsSettings, type SubjectSetting } from "./settings-types";

/** 저장 폼이 있는 두 면. 값은 요청의 `operationsFace`로 그대로 온다. */
export const OPERATIONS_FACES = ["operations", "subjects"] as const;
export type OperationsFace = (typeof OPERATIONS_FACES)[number];

/** 면이 맡는 칸 — 그 면의 저장은 이 칸만 바꾼다. */
export const OPERATIONS_FACE_KEYS = {
  operations: [
    "weekdayPeriods",
    "weekendPeriods",
    "gradeLevels",
    "jobTitles",
    "jobTitlesByDepartment",
    "holidays",
    "shuttle",
    "seatPins",
  ],
  subjects: ["subjects", "weekdayGroupings", "hiddenBuiltinWeekdayGroupings"],
} as const satisfies Record<OperationsFace, readonly (keyof OperationsSettings)[]>;

/** 어느 면도 맡지 않는 칸 — 편집 화면이 없어 어떤 저장에서도 fresh 값이 그대로 남는다. */
export const OPERATIONS_UNOWNED_KEYS = ["periodStyle", "schoolSaveAliases", "terms"] as const satisfies readonly (keyof OperationsSettings)[];

/** 과목 행 안에서 **시간표 쪽이 맡는** 칸 — 과목 운영 면은 이 칸을 읽지도 쓰지도 않는다. */
export const TIMETABLE_SUBJECT_KEYS = [
  "teacherViewOrder",
  "integrationGroups",
  "integrationGroupsEnabled",
  "integrationShowOthers",
  "integrationOthersTitle",
  "integrationGroupPresets",
] as const satisfies readonly (keyof SubjectSetting)[];
type TimetableSubjectKey = (typeof TIMETABLE_SUBJECT_KEYS)[number];

/** 시간표 쪽 저장이 보내는 조각. `null` = 그 칸을 지운다, 안 보낸 칸 = 그대로 둔다. */
export type SubjectFieldsPatch = { [K in TimetableSubjectKey]?: SubjectSetting[K] | null };

const subjectKeySchema = z.string().min(1).max(24).regex(/^[a-z0-9_]+$/);

/** 시간표 쪽 서버 호출의 요청 — 허용한 여섯 칸 밖의 속성은 거절한다. */
export const subjectFieldsRequestSchema = z.strictObject({
  subject: subjectKeySchema,
  fields: z.strictObject({
    teacherViewOrder: subjectSchema.shape.teacherViewOrder.nullable(),
    integrationGroups: subjectSchema.shape.integrationGroups.nullable(),
    integrationGroupsEnabled: subjectSchema.shape.integrationGroupsEnabled.nullable(),
    integrationShowOthers: subjectSchema.shape.integrationShowOthers.nullable(),
    integrationOthersTitle: subjectSchema.shape.integrationOthersTitle.nullable(),
    integrationGroupPresets: subjectSchema.shape.integrationGroupPresets.nullable(),
  }),
});
export const subjectRemoveRequestSchema = z.strictObject({ key: subjectKeySchema });

function withoutTimetableKeys(subject: SubjectSetting): SubjectSetting {
  const out: SubjectSetting = { ...subject };
  for (const key of TIMETABLE_SUBJECT_KEYS) delete out[key];
  return out;
}

/** fresh 과목 행의 시간표 칸 — **없는 칸은 없는 채로**(옛 값을 되살리지 않는다). */
function timetablePart(subject: SubjectSetting | undefined): Partial<SubjectSetting> {
  const out: Record<string, unknown> = {};
  if (!subject) return out;
  for (const key of TIMETABLE_SUBJECT_KEYS) if (subject[key] !== undefined) out[key] = subject[key];
  return out as Partial<SubjectSetting>;
}

/**
 * 면 저장 — fresh 위에 그 면이 맡는 칸만 얹는다.
 * 과목 운영 면: 보낸 과목 행에서 시간표 칸을 **먼저 지우고** fresh 같은 과목의 값(또는 부재)을 붙인다.
 * fresh에 없는 새 과목은 시간표 칸 없이 받는다.
 */
export function applyOperationsFace(
  fresh: OperationsSettings,
  incoming: OperationsSettings,
  face: OperationsFace,
): OperationsSettings {
  const next: Record<string, unknown> = { ...fresh };
  for (const key of OPERATIONS_FACE_KEYS[face]) next[key] = incoming[key];
  if (face === "subjects") {
    const freshByKey = new Map(fresh.subjects.map((s) => [s.key, s]));
    next.subjects = incoming.subjects.map((s) => ({ ...withoutTimetableKeys(s), ...timetablePart(freshByKey.get(s.key)) }));
  }
  return next as OperationsSettings;
}

/** 시간표 쪽 저장 — 그 과목 행의 보낸 칸만 바꾼다. 과목이 없으면 null(없는 과목을 만들지 않는다). */
export function applySubjectFields(
  fresh: OperationsSettings,
  subject: string,
  fields: SubjectFieldsPatch,
): OperationsSettings | null {
  if (!fresh.subjects.some((s) => s.key === subject)) return null;
  return {
    ...fresh,
    subjects: fresh.subjects.map((s) => {
      if (s.key !== subject) return s;
      const out: Record<string, unknown> = { ...s };
      for (const key of TIMETABLE_SUBJECT_KEYS) {
        const value = fields[key];
        if (value === undefined) continue;
        if (value === null) delete out[key];
        else out[key] = value;
      }
      return out as SubjectSetting;
    }),
  };
}

/** 과목 행 제거 — 없으면 fresh 그대로(`removed: false`). */
export function removeSubjectRow(fresh: OperationsSettings, key: string): { next: OperationsSettings; removed: boolean } {
  const subjects = fresh.subjects.filter((s) => s.key !== key);
  return subjects.length === fresh.subjects.length
    ? { next: fresh, removed: false }
    : { next: { ...fresh, subjects }, removed: true };
}

/** 그 면이 맡는 칸만 뽑은 사본 — 과목 삭제 응답이 화면에 돌려주는 확정 상태. */
export function operationsFaceSnapshot<F extends OperationsFace>(
  operations: OperationsSettings,
  face: F,
): Pick<OperationsSettings, (typeof OPERATIONS_FACE_KEYS)[F][number]> {
  const out: Record<string, unknown> = {};
  for (const key of OPERATIONS_FACE_KEYS[face]) out[key] = operations[key];
  return out as Pick<OperationsSettings, (typeof OPERATIONS_FACE_KEYS)[F][number]>;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((k) => [k, sortKeys(source[k])]));
  }
  return value;
}

/**
 * 면의 비교용 표준 문자열 — "이 면이 맡는 값이 그사이 바뀌었나"를 화면과 저장이 **같은 함수**로 판정한다.
 *  · 스키마로 정규화한다: 옛 저장 행의 '칸 없음'과 스키마 기본값(`testMax: 5` 등)을 같은 값으로 본다
 *    (시간표 쪽 저장이 섹션을 다시 쓰면서 기본값이 채워져도 과목 운영 면이 충돌로 오인하지 않게).
 *    정규화에 실패하는 저장값은 원본 그대로 비교한다(양쪽이 같은 경로).
 *  · 과목 행의 시간표 칸은 뺀다(시간표·cron·시트 반영은 이 면의 변경이 아니다).
 *  · 객체 키는 정렬하고 배열 순서는 유지한다(과목·교시 순서는 의미가 있다).
 * 🔴 운영 체계 면의 문자열에는 자리 PIN이 들어 있다 — 그대로 내려보내지 말고 서버에서 해시한다(`operations-token.ts`).
 */
export function operationsFaceCanonical(operations: OperationsSettings, face: OperationsFace): string {
  const parsed = operationsSchema.safeParse(operations);
  const normalized = parsed.success ? parsed.data : operations;
  const slice: Record<string, unknown> = { ...operationsFaceSnapshot(normalized, face) };
  if (face === "subjects") slice.subjects = normalized.subjects.map(withoutTimetableKeys);
  return JSON.stringify(sortKeys(slice));
}
