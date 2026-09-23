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

export type ExamSlotKey = "listening" | "midterm" | "final" | "school" | "monthly";

export const EXAM_SLOT_LABEL: Record<ExamSlotKey, string> = {
  listening: "듣기평가",
  midterm: "중간고사",
  final: "기말고사",
  school: "내신",
  monthly: "월말평가",
};

const DEFAULT_SLOTS: readonly ExamSlotKey[] = ["midterm", "final"];

/**
 * 과목 표준 키별 예외. 여기 없는 과목은 전부 기본 두 칸.
 * ⚠️ 수학의 `내신`·`월말평가`는 원장 2026-09-22 추가 — **수학에만** 세운다(다른 과목은 요청이 없었다).
 */
const SLOTS_BY_SUBJECT: Record<string, readonly ExamSlotKey[]> = {
  english: ["listening", "midterm", "final"],
  math: ["midterm", "final", "school", "monthly"],
};

/**
 * **달마다 치는 시험인가** — 월말평가 하나(원장 2026-09-23: *"시험일이 있으니까 월도 선택해서 볼수있게"*).
 *
 * 🔑 왜 축이 필요한가: 성적 칸의 주인은 `(학생, 과목, 년도, 학기, 시험)`이라 **한 학기에 한 번**이다.
 *    중간·기말·듣기평가는 실제로 한 번씩이라 맞지만 월말평가는 9월·10월·11월…이 따로라, 월이 없으면
 *    10월을 저장하는 순간 9월을 덮어쓴다(에러 없이 조용히 — 0287a가 유니크 축에 월을 더한다).
 * 🔴 다른 시험에 월을 열지 말 것 — 열면 `(중간고사, 5월)`과 `(중간고사, 6월)`이 다른 칸이 되어
 *    한 학생의 중간고사가 둘로 갈린다(학생 상세 추이·급락 감지가 서로 다른 것을 본다).
 */
export function slotUsesMonth(slot: ExamSlotKey): boolean {
  return slot === "monthly";
}

/**
 * 그 칸의 **월**(1~12). 월을 안 쓰는 시험은 `0`이다 — 유니크 축의 '월 미지정' 자리이고,
 * null이 아니다(null은 서로 안 겹쳐 같은 중간고사 행이 여러 개 생긴다, [[#113]] 계열).
 * 🔑 월은 **시험일에서 도출**한다 — 따로 든 값과 날짜가 어긋날 자리를 아예 만들지 않는다.
 */
export function gradeMonthOf(slot: ExamSlotKey, dateIso: string): number {
  if (!slotUsesMonth(slot)) return 0;
  const m = Number(String(dateIso ?? "").slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 0;
}

export function examSlotsFor(subjectKey: string): ExamSlotKey[] {
  return [...(SLOTS_BY_SUBJECT[subjectKey] ?? DEFAULT_SLOTS)];
}

export function isExamSlot(v: unknown): v is ExamSlotKey {
  return (
    v === "listening" || v === "midterm" || v === "final" || v === "school" || v === "monthly"
  );
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
