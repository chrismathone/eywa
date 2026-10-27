/**
 * **새 보고서(수학 전원 · 영어 사랑의 한마디) 발송 조건** — 행 하나가 지금 보낼 수 있는 상태인가. 순수 모듈(Vitest).
 *
 * 원장 2026-10-26 *"보기 형식 표로해서 일괄입력할 때 문제되는 부분"* → *"1~4 모두 변경"*. 카드·표의 발송 버튼은
 * `evaluateSendGate`로 이 조건을 막았지만 **일괄 발송·일괄 자동작성은 그 판정을 거치지 않았다** — 사유 없는 미제출·
 * 값이 바뀐 옛 자동작성 글이 일괄 발송으로는 그대로 나갔다. 그래서 조건을 여기 한 곳에 모으고 일괄 경로·저장 입력이 같이 쓴다.
 * ⚠️ 판정 재료는 카드·표 게이트와 **같은 함수**다(pilotNeedsAutoWrite · pilotRowSig · testSkipComplete · needsHomeworkMissReason).
 */
import { hasPilotOneLine, isMathReportPilot, pilotNeedsAutoWrite } from "./math-report-pilot";
import { needsAttitudeNote, needsHomeworkMissReason, pilotRowSig, testSkipComplete } from "./math-report-pilot-sections";
import { isJjSheetDraft } from "./jj-books";
import { resolveRowFields } from "./row-fields";
import type { OneScreenStudent } from "./types";

export type PilotSendBlock = "autowrite" | "oneline" | "testReason" | "homeworkReason" | "attitudeNote";

/** 사유·의견 칸이 모자라 막는 조건 — 서버 `pilotCheck.reasonsOk`가 이것들을 본다. */
export const REASON_BLOCKS: readonly PilotSendBlock[] = ["testReason", "homeworkReason", "attitudeNote"];

type RowReport = { draft?: string | null; autoDraft?: string | null; pilotFactsSig?: string; templateId?: string } | null | undefined;

/** 이 행을 막는 조건들(없으면 []). 새 수학 보고서도 영어도 아닌 행은 늘 []. */
export function pilotSendBlocks(student: OneScreenStudent, subjectName: string, rep: RowReport): PilotSendBlock[] {
  const su = student.subjects.find((s) => s.name === subjectName);
  if (!su) return [];
  const pilot = isMathReportPilot(student.id, su.subjectKey);
  const english = su.subjectKey === "english";
  if (!pilot && !english) return [];
  const ev = resolveRowFields(student, su);
  const out: PilotSendBlock[] = [];
  if (
    pilot &&
    pilotNeedsAutoWrite(rep?.draft, rep?.autoDraft, {
      studentName: student.name,
      today: su.today,
      progressMode: su.progressMode,
      note: ev.note,
      factsSig: pilotRowSig(student, su.name),
      writtenSig: rep?.pilotFactsSig,
    })
  )
    out.push("autowrite");
  // JJ 수업보고서 글은 사랑의 한마디가 선택이다 — 비우면 그 항목이 빠진다(원장 2026-10-27, jj-books.ts).
  if (!hasPilotOneLine(ev.note) && !(english && isJjSheetDraft(rep))) out.push("oneline");
  if (pilot && !testSkipComplete(su.dailyTestSkip)) out.push("testReason");
  if (pilot && needsHomeworkMissReason(ev.homework, su.homeworkMissReason)) out.push("homeworkReason");
  // 수업 태도 하·중하 → 강사 의견 3줄 이상(새 수학 보고서, 2026-10-26).
  if (pilot && needsAttitudeNote(ev.attitude, su.attitudeNote)) out.push("attitudeNote");
  // 보강 사유는 발송 조건이 아니다(원장 2026-10-27 *"사유 없어도 발송되게"*) — 결석 날짜를 모르는 보강(다른 반 학생 등)은
  //   사유가 비면 "오늘은 보강 수업에 출석했습니다"로 나간다(attendance-sentence.ts). 사유 칸은 선택 입력으로 남는다.
  return out;
}
