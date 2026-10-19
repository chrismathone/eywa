/**
 * 수학 교재 배정 규칙 — 순수 함수(화면·서버 액션이 같은 답을 내도록 한 곳에 둔다).
 *
 * 자리는 둘이다(표 = `math_textbook_assignments`):
 *  · 반 교재   — 그 반 학생 전원의 기본 교재
 *  · 학생 교재 — 그 학생만. **반 교재보다 우선**한다(수학은 학생마다 제 교재를 나가는 반이 많다).
 *
 * "같은 교재" 확인은 두 갈래다(원장 2026-10-19 *"동일한 교재 배정하려고하면 동일한 교재가 있다고 얼럿 띄운 후
 * 해당 교재로 변경할지 취소할지"* → 둘 다):
 *  ① 직접 적은 이름이 교재목록의 교재와 **같은 책**이면 → 그 교재로 바꿀지 묻는다(`findSameCatalogTitle`).
 *  ② 그 학생에게 이미 같은 교재가 걸려 있으면(반에서 받은 교재 포함) → 알리고 묻는다(`assignmentConflict`).
 */

export type AssignedBook = { textbookId: string; title: string };
export type EffectiveBook = AssignedBook & { source: "student" | "class" };

/** 같은 책 판정 키 — 공백·대소문자 차이는 같은 책으로 본다(`가우스 중2-1 발전 1권` = `가우스중2-1발전1권`). */
export function bookTitleKey(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase();
}

/** 학생의 지금 교재 — 학생 교재가 있으면 그것, 없으면 반 교재. */
export function effectiveMathBook(
  classBook: AssignedBook | null,
  studentBook: AssignedBook | null,
): EffectiveBook | null {
  if (studentBook) return { ...studentBook, source: "student" };
  if (classBook) return { ...classBook, source: "class" };
  return null;
}

/**
 * ① 직접 적은 교재 이름이 교재목록에 이미 있는지.
 * - 글자까지 같으면 묻지 않는다(이미 그 교재다) → null
 * - 같은 책인데 표기만 다르면 그 교재 이름을 돌려준다 → 화면이 "그 교재로 변경할까요?"를 띄운다
 */
export function findSameCatalogTitle(input: string | null | undefined, catalog: readonly string[]): string | null {
  const typed = (input ?? "").trim();
  if (!typed) return null;
  if (catalog.includes(typed)) return null;
  const key = bookTitleKey(typed);
  return catalog.find((title) => bookTitleKey(title) === key) ?? null;
}

export type AssignmentConflict =
  /** 이 자리에 이미 같은 교재가 걸려 있다 — 바꿀 것이 없다. */
  | { kind: "same-slot"; title: string }
  /** 학생 자리에 거는데, 그 학생이 반 교재로 이미 같은 교재를 받고 있다 — 학생 교재로 고정할지 묻는다. */
  | { kind: "same-as-class"; title: string };

/**
 * ② 배정하려는 교재가 그 자리(또는 그 학생)에 이미 걸려 있는지.
 * `studentId`가 null이면 반 자리다. 해제(textbookId null)는 충돌이 아니다.
 */
export function assignmentConflict(args: {
  scope: "class" | "student";
  textbookId: string | null;
  classBook: AssignedBook | null;
  studentBook: AssignedBook | null;
}): AssignmentConflict | null {
  const { scope, textbookId, classBook, studentBook } = args;
  if (!textbookId) return null;
  if (scope === "class") {
    return classBook?.textbookId === textbookId ? { kind: "same-slot", title: classBook.title } : null;
  }
  if (studentBook?.textbookId === textbookId) return { kind: "same-slot", title: studentBook.title };
  if (!studentBook && classBook?.textbookId === textbookId) return { kind: "same-as-class", title: classBook.title };
  return null;
}
