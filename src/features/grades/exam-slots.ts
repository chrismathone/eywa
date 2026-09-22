/**
 * 성적의 **시험 칸** — 과목마다 정해진 시험 이름(원장 2026-09-22: *"수학은 중간고사·기말고사,
 * 영어는 듣기평가·중간고사·기말고사"*).
 *
 * 🔑 자유 텍스트 시험명을 **고정 목록**으로 바꾼 자리다. 자유 텍스트는 같은 시험이 `중간`·`중간고사`·
 *    `1학기 중간`으로 갈라져 학생 상세 추이와 성적 급락 감지가 서로 다른 것을 보게 만든다.
 * 🔑 **코드 고정이 맞다** — 학교 시험 이름은 학원이 정하는 값이 아니다(CLAUDE.md: *"시험유형은 운영
 *    enum이 아니다"*). 과목 **라벨·색**은 여전히 학원설정(`buildSubjectMaps`)에서 읽는다.
 * ⚠️ `english`는 과목 **표준 키**라 코드가 특수동작을 걸어도 되는 범위다(KNOWN_SUBJECT_KEYS, JJ 보기 선례).
 *    등록되지 않은 과목·새 과목은 기본 두 칸(중간·기말)으로 떨어진다.
 * ⚠️ DB에는 이 **키**(`exam_slot`)와 라벨(`exam_name`)을 함께 저장한다 — 라벨을 저장해 두면 0283a가
 *    아직 안 걸린 창에서도 학생 상세·타임라인이 시험 이름을 계속 읽는다([[#95]]).
 */

export type ExamSlotKey = "listening" | "midterm" | "final";

export const EXAM_SLOT_LABEL: Record<ExamSlotKey, string> = {
  listening: "듣기평가",
  midterm: "중간고사",
  final: "기말고사",
};

const DEFAULT_SLOTS: readonly ExamSlotKey[] = ["midterm", "final"];

/** 과목 표준 키별 예외. 여기 없는 과목은 전부 기본 두 칸. */
const SLOTS_BY_SUBJECT: Record<string, readonly ExamSlotKey[]> = {
  english: ["listening", "midterm", "final"],
};

export function examSlotsFor(subjectKey: string): ExamSlotKey[] {
  return [...(SLOTS_BY_SUBJECT[subjectKey] ?? DEFAULT_SLOTS)];
}

export function isExamSlot(v: unknown): v is ExamSlotKey {
  return v === "listening" || v === "midterm" || v === "final";
}

/** 주소·시트의 값을 그 과목의 시험 칸으로. 그 과목에 없는 칸이면 **첫 칸**으로 떨어진다. */
export function normalizeExamSlot(subjectKey: string, raw: unknown): ExamSlotKey {
  const slots = examSlotsFor(subjectKey);
  const v = typeof raw === "string" ? raw.trim() : "";
  return isExamSlot(v) && slots.includes(v) ? v : slots[0]!;
}

export function examSlotOptions(subjectKey: string): { value: ExamSlotKey; label: string }[] {
  return examSlotsFor(subjectKey).map((key) => ({ value: key, label: EXAM_SLOT_LABEL[key] }));
}

/** 라벨 → 칸 키(엑셀이 이름으로 적혀 오는 자리). 모르는 이름은 null. */
export function examSlotFromLabel(label: unknown): ExamSlotKey | null {
  const t = String(label ?? "").replace(/\s+/g, "");
  const hit = (Object.keys(EXAM_SLOT_LABEL) as ExamSlotKey[]).find(
    (k) => EXAM_SLOT_LABEL[k].replace(/\s+/g, "") === t,
  );
  return hit ?? null;
}
