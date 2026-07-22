/**
 * 교재요청 발송 대상 묶기(순수 함수 + Vitest) — "어떤 학생에게 어떤 글·어떤 첨부를 보낼지".
 *
 * 본문 문장 조립은 [`textbook-notice.ts`](./textbook-notice.ts)가, **인가·게이트·큐 적재**는 서버 액션이 맡는다.
 * 그 사이의 규칙(같은 학생 여러 건 합치기, 과목 없는 학생 제외)만 여기 순수 함수로 떼어 테스트한다.
 */

import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import { textbookNoticeIndividual, type TextbookNoticeAccount } from "./textbook-notice";

/** 발송 대상 행(순수 입력) — textbook_orders에서 **학부모에게 나가는 값만**. notes(내부 메모)는 없다. */
export type TextbookNoticeOrderRow = {
  studentId: string | null;
  studentName: string | null;
  bookName: string;
  bookDetail: string | null;
  price: number;
  requestDate: string | null;
};

export type TextbookNoticeGroup = {
  students: { studentId: string; subject: string; individualBody: string; attachments: NoticeAttachment[] }[];
  skipped: { name: string; reason: "no_student" | "no_subject" }[];
};

/**
 * 요청 행 → **학생별 발송 묶음**.
 * - 같은 학생의 요청이 여러 건이면 한 보드에 **한 글**로 합친다(보드 중복 = 조용한 누락).
 * - 멘트는 첫 덩이에만 넣는다(같은 문장 반복 방지).
 * - 학생 연결이 없거나(`no_student`) 보낼 보드 과목이 없으면(`no_subject`) 제외 목록으로 돌려준다.
 * `subjectOf`는 **보드 prefix까지 검증된** 과목만 돌려줘야 한다(호출자가 BOARD_PREFIX로 확인).
 */
export function groupTextbookNoticeStudents(
  rows: readonly TextbookNoticeOrderRow[],
  opts: {
    ment: string;
    account: TextbookNoticeAccount;
    subjectOf: (studentId: string) => string | null;
    attachmentsOf?: (studentId: string) => NoticeAttachment[] | undefined;
  },
): TextbookNoticeGroup {
  const skipped: TextbookNoticeGroup["skipped"] = [];
  const byStudent = new Map<string, { name: string | null; blocks: string[] }>();
  for (const r of rows) {
    if (!r.studentId) {
      skipped.push({ name: r.studentName ?? "이름 없음", reason: "no_student" });
      continue;
    }
    const g = byStudent.get(r.studentId) ?? { name: r.studentName, blocks: [] };
    g.blocks.push(
      textbookNoticeIndividual(g.blocks.length === 0 ? opts.ment : "", {
        studentName: r.studentName,
        bookName: r.bookName,
        bookDetail: r.bookDetail,
        price: r.price,
        requestDate: r.requestDate,
        account: opts.account,
      }),
    );
    byStudent.set(r.studentId, g);
  }

  const students: TextbookNoticeGroup["students"] = [];
  for (const [studentId, g] of byStudent) {
    const subject = opts.subjectOf(studentId);
    if (!subject) {
      skipped.push({ name: g.name ?? "이름 없음", reason: "no_subject" });
      continue;
    }
    students.push({
      studentId,
      subject,
      individualBody: g.blocks.join("\n\n"),
      attachments: opts.attachmentsOf?.(studentId) ?? [],
    });
  }
  return { students, skipped };
}
