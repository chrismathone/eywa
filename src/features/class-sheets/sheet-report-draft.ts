/**
 * **ECS 시트 → 수업보고서 초안**(순수 함수, DB·IO 없음).
 *
 * 배경(2026-08-07 연동 검토): 영어 강사가 ECS 시트에 적은 교재·진도·과제(실측 7/1~8/7 계획 762행 중
 * 교재 734·진도 577·과제 483)가 원스크린 보고서로 **한 줄도 흐르지 않았다**(같은 기간 영어 보고서 0건,
 * 시트가 채워진 257 (반,날짜) 중 보고서가 있는 날 0). 강사는 같은 내용을 두 번 친다. 그 다리가 이 함수다.
 *
 * 🔑 **반 단위 사실만 옮긴다** — 교재·진도·과제는 그 반 학생 전원에게 같다. 학생별 개인 기록
 *    (`class_sheet_student_marks.progress_note` = "PL 7, 20개 / PV 4")은 문맥이 제각각이라 자동으로
 *    보고서에 넣지 않고 **참고로만** 보여준다(강사가 보고 옮긴다). 발송물에 들어가는 값이라 그렇다.
 * ⚠️ 여기서 만드는 건 **초안**이다 — 저장·발송은 강사가 눌러야 일어난다(기존 세션 입력이 항상 우선).
 */

/** 시트 계획 한 줄 — DB row의 부분집합(호출부가 매핑해서 넘긴다). */
export type SheetPlanLine = {
  slotStart: string; // "15:00"
  lineNo: number;
  skillArea: string | null; // 영역 키(settings의 skillAreas[].key)
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

export type SheetDraft = {
  /** 교재명 — 여러 교시면 " · "로 이어붙임(중복 제거). */
  textbook: string;
  /** 오늘 진도 — 교시·줄 순서로 한 줄씩(영역 라벨 접두). */
  progress: string;
  /** 오늘 과제 — 같은 규약. */
  homework: string;
};

/** 값 정리 — 공백만이면 빈 문자열(시트는 빈 칸을 ""·null 둘 다로 남긴다). */
function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * 계획 줄들을 보고서 초안 3종으로 접는다.
 *
 * - 정렬은 **교시 시각 → 줄 번호**(화면에 보이는 순서 그대로 문장이 되게).
 * - 영역 라벨은 있으면 접두로 붙인다("Grammar Ch 12 unit 1") — 학부모 멘트에서 영역이 살아난다.
 *   미등록 키는 라벨을 지어내지 않고 생략한다(#raw 코드 노출 금지 — "vocab" 같은 영문 키를 그대로 쓰지 않는다).
 * - 페이지는 진도 뒤 괄호로("Reading section 5-1 (p.20~22)"). 진도가 비고 페이지만 있으면 페이지가 진도가 된다.
 *
 * @param labelOf 영역 키 → 한글/표시 라벨. 모르면 null을 돌려준다(그러면 접두 없이 값만).
 */
export function buildSheetDraft(lines: SheetPlanLine[], labelOf: (key: string) => string | null): SheetDraft {
  const sorted = lines
    .slice()
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart) || a.lineNo - b.lineNo);

  const books: string[] = [];
  const progress: string[] = [];
  const homework: string[] = [];

  for (const l of sorted) {
    const area = l.skillArea ? clean(labelOf(l.skillArea) ?? "") : "";
    const prefix = area ? `${area} ` : "";

    const book = clean(l.textbook);
    if (book && !books.includes(book)) books.push(book);

    const prog = clean(l.progress);
    const page = clean(l.pageRange);
    if (prog || page) {
      progress.push(prog ? `${prefix}${prog}${page ? ` (${page})` : ""}` : `${prefix}${page}`);
    }

    const hw = clean(l.homework);
    if (hw) homework.push(`${prefix}${hw}`);
  }

  return {
    textbook: books.join(" · "),
    // ⚠️ 진도·과제는 **여러 줄**로 둔다 — 보고서 진도는 원래 다중 차시를 개행으로 담고
    //    (report-comment.ts flatten 주석), AI 멘트 빌더가 그 형식을 이미 다룬다.
    progress: progress.join("\n"),
    homework: homework.join("\n"),
  };
}

/** 초안이 실제로 내용이 있는가(전부 비면 화면에 '시트에서 가져오기'를 띄울 이유가 없다). */
export function hasSheetDraft(d: SheetDraft | null | undefined): boolean {
  return !!d && (d.textbook !== "" || d.progress !== "" || d.homework !== "");
}
