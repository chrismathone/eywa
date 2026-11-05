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
 * ⚠️ 수학의 `월말평가`는 원장 2026-09-22 추가 — **수학에만** 세운다(다른 과목은 요청이 없었다).
 * 🔴 수학 학교 시험은 **중간·기말**이다(원장 2026-10-14 *"성적에서 중간/기말 구분이 필요함"* · *"현재 수학 입력되어있는건
 *    26년도 2학기 중간으로 전체 분류"*) — 2026-09-23에 둘을 `내신` 한 칸으로 합쳤던 것을(0289a) 되돌렸다. 그때 적힌 수학
 *    `내신` 49건(전부 2026년 2학기)은 배포 직후 중간고사로 옮기고(`scripts/_oneoff/math-school-to-midterm.mjs`), DB 제약
 *    0363a가 수학 내신 저장을 막는다. `school` 키·라벨은 옛 행을 읽기 위해서만 남긴다(새로 쓰지 않는다).
 */
const SLOTS_BY_SUBJECT: Record<string, readonly ExamSlotKey[]> = {
  // 영어 월말 시험(Monthly Test — 원장 2026-11-04)은 수학 월말평가와 같은 칸(`monthly`·월 축)이고, 화면 이름과 영역 점수만 다르다.
  english: ["listening", "midterm", "final", "monthly"],
  math: ["midterm", "final", "monthly"],
};

/**
 * **달마다 치는 시험인가** — 월말평가 하나(원장 2026-09-23: *"시험일이 있으니까 월도 선택해서 볼수있게"*).
 *
 * 🔑 왜 축이 필요한가: 성적 칸의 주인은 `(학생, 과목, 년도, 학기, 시험)`이라 **한 학기에 한 번**이다.
 *    중간·기말·듣기평가는 실제로 한 번씩이라 맞지만 월말평가는 9월·10월·11월…이 따로라, 월이 없으면
 *    10월을 저장하는 순간 9월을 덮어쓴다(에러 없이 조용히 — 0288a가 유니크 축에 월을 더한다).
 * 🔴 다른 시험에 월을 열지 말 것 — 열면 `(중간고사, 5월)`과 `(중간고사, 6월)`이 다른 칸이 되어
 *    한 학생의 중간고사가 둘로 갈린다(학생 상세 추이·급락 감지가 서로 다른 것을 본다).
 */
/**
 * 월 축(0288a) 미적용 상태에서 월말평가를 저장하려 할 때의 **사용자용 사유** — 화면 셋이 같은 문장을
 * 쓴다(격자 저장 액션·학생 상세 폼·공용 저장 경로). 🔴 `catch`에서 "저장하지 못했습니다"로 뭉개지
 * 말 것: 원인을 모르면 사람이 같은 저장을 영원히 다시 누른다.
 */
export const GRADE_MONTH_NOT_READY = "월 축 준비(0288a)가 아직 적용되지 않아 월말평가는 저장할 수 없습니다";

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

/** 그 과목에서 부르는 시험 이름 — 영어 월말 시험만 `Monthly Test`(원장 2026-11-04 · 시트 제목 그대로), 나머지는 공통 라벨. */
export function examSlotLabel(subjectKey: string, slot: ExamSlotKey): string {
  return subjectKey === "english" && slot === "monthly" ? "Monthly Test" : EXAM_SLOT_LABEL[slot];
}

export function examSlotOptions(subjectKey: string): { value: ExamSlotKey; label: string }[] {
  return examSlotsFor(subjectKey).map((key) => ({ value: key, label: examSlotLabel(subjectKey, key) }));
}

/** 라벨 → 칸 키(엑셀이 이름으로 적혀 오는 자리). 모르는 이름은 null. */
export function examSlotFromLabel(label: unknown): ExamSlotKey | null {
  const t = String(label ?? "").replace(/\s+/g, "");
  if (t.toLowerCase() === "monthlytest") return "monthly";
  const hit = (Object.keys(EXAM_SLOT_LABEL) as ExamSlotKey[]).find(
    (k) => EXAM_SLOT_LABEL[k].replace(/\s+/g, "") === t,
  );
  return hit ?? null;
}
