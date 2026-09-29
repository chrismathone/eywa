// 문항 세트 **시작 문안** — '새 세트'를 빈 종이 대신 이 문안으로 시작한다(편집기에서 고쳐 저장).
// 🔑 여기 있는 건 DB 세트가 아니다: 저장하기 전엔 어떤 평가지에도 안 쓰인다(세트 = academy_documents 행).
import { CHECKLIST_AREAS, type ChecklistArea } from "./checklist";

/**
 * 강사평가 — 원장 시트 "강사평가/청강보고서" · `강사평가(김미)` 탭 문항 그대로(2026-09-29 캡처).
 * 시트 척도 ①전혀 그렇지 않다 ②그렇지 않다 ③그런 편이다 ④매우 그렇다 = 앱 4점 척도와 같은 폭.
 * 시트 셀의 줄바꿈 괄호 설명은 한 줄로 이어 붙였다(문구는 바꾸지 않음).
 */
export const TEACHER_EVAL_AREAS: ChecklistArea[] = [
  {
    key: "lesson",
    title: "수업",
    items: [
      "수업준비가 철저하다.",
      "상담율이 높다. (전화, 문자, 보고서 등)",
      "내신시험 준비가 잘 되어 성적부진으로 인한 퇴원이 없다.",
      "담당하는 학생들의 지각, 조퇴가 없다. (이월포함)",
      "수업에 대한 클레임이 없다.",
      "수업중 학생들과의 커뮤니케이션이 활발하며, 적극적인 자세로 수업을 이끌어 나가고 학생들과의 관계성이 좋다.",
    ],
  },
  {
    key: "work",
    title: "업무",
    items: [
      "열정적인가? 에너지 (내 팀에서 함께 일하고 싶은 사람이다)",
      "조직화합 기여도 (동료, 경영팀과의 관계)",
      "성실한가? (근태 - 계약 조건에 약속된 시간을 잘 지킨다.)",
      "내 팀으로 스카웃해오고 싶은 사람이다.",
      "참여도 (학원의 모든 행사에 적극적으로 참여하고 있는가?)",
      "학생들의 만족도가 높은가?",
    ],
  },
  {
    key: "admin",
    title: "학원행정사항",
    items: [
      "학원행정 업무에 적극적인가?",
      "개인역량 강화 (스터디 참여)",
      "사무 처리능력 (수강료 발생, 보고서 작성, 책 발주)",
    ],
  },
];

export type ChecklistPreset = { key: string; name: string; areas: ChecklistArea[] };

/** 새 세트 시작 문안 목록 — 첫 항목이 기본(`?new=1`). */
export const CHECKLIST_PRESETS: ChecklistPreset[] = [
  { key: "class", name: "수업 참관", areas: CHECKLIST_AREAS },
  { key: "teacher", name: "강사평가", areas: TEACHER_EVAL_AREAS },
];

/** `?new=` 값 → 시작 문안. 모르는 값·`1`은 기본(수업 참관). */
export function presetOf(key: string | undefined): ChecklistPreset {
  return CHECKLIST_PRESETS.find((p) => p.key === key) ?? CHECKLIST_PRESETS[0];
}
