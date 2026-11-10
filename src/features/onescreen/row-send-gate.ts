/**
 * 원스크린 한 행의 발송 게이트 **재료 조립** — 카드(report-card)와 표(grid-row)가 함께 부른다(수정 계획 P1-O · 리뷰 B5).
 *
 * 예전엔 두 화면이 `evaluateSendGate` 입력 25줄을 따로 적었고 이미 어긋나 있었다 — 카드만 `recallPending`을 넘겨서,
 * 회수가 진행 중일 때 카드는 발송을 막는데 표 행은 버튼이 살아 있었다(서버는 거절 → "눌렀는데 안 됨").
 * 판정 자체는 `send-gate.ts` 한 곳이고, 여기는 "무엇을 넣나"를 한 곳에 둔다. 새 조건은 여기에만 더한다.
 */
import { evaluateSendGate, type SendGate } from "./send-gate";
import type { SheetLang } from "@/features/teacher-view/i18n";
import {
  effectiveClassnoteStatus,
  isAlreadySent,
  isAttendanceUnchecked,
  isReportEligible,
  isReportOptoutRow,
} from "./grid";
import { hasPilotOneLine, isMathReportPilot, pilotNeedsAutoWrite } from "./math-report-pilot";
import { needsAttitudeNote, needsHomeworkMissReason, pilotRowSig, testSkipComplete } from "./math-report-pilot-sections";
import { needsMakeupCheck } from "./reserved-makeup";
import { isJjSheetDraft, isProgressOptionalReport } from "./jj-books";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import { resolveRowFields } from "./row-fields";
import { isRecallInFlight } from "@/features/report-admin/report-recall";
import type { OneScreenStudent, Subject } from "./types";
import type { SubjectReport } from "./components/report-card";

export function rowSendGate(args: {
  lang: SheetLang;
  student: OneScreenStudent;
  subject: Subject;
  rep: SubjectReport | undefined;
  /** '다른 강사 뷰'(열람 전용) */
  readonlyView: boolean;
  /** 출결 쓰기 권한 없음 — 출결 미체크 조건을 걸지 않는다(P0-3) */
  attendanceReadOnly: boolean;
}): SendGate {
  const { lang, student, subject, rep } = args;
  const fields = resolveRowFields(student, subject);
  const liveStatus = effectiveClassnoteStatus(rep?.classnoteStatus, subject.classnoteStatus);
  // 수학 보고서 시범(테스트 학생 한정) — 자동작성 글 그대로여야 발송.
  const pilot = isMathReportPilot(student.id, subject.subjectKey);
  // '사랑의 한마디' 행 — 새 수학 보고서 + 영어(원장 2026-10-26). JJ 수업보고서 글은 선택(2026-10-27).
  const oneLineRow = pilot || subject.subjectKey === "english";
  const jjOptionalNote = subject.subjectKey === "english" && isJjSheetDraft(rep);
  const progressOptional = isProgressOptionalReport(subject, rep); // SRS 글은 진도 항목이 없다(원장 2026-11-05)
  return evaluateSendGate({
    lang, // 🔴 판정이 아니라 **글자**만 갈린다(canSend·reasons 불변)
    needsAutoWrite:
      pilot &&
      pilotNeedsAutoWrite(rep?.draft, rep?.autoDraft, {
        studentName: student.name,
        today: subject.today,
        progressMode: subject.progressMode,
        note: fields.note,
        factsSig: pilotRowSig(student, subject.name),
        writtenSig: rep?.pilotFactsSig,
      }),
    needsOneLine: oneLineRow && !jjOptionalNote && !hasPilotOneLine(fields.note), // 사랑의 한마디 필수(원장 2026-10-22)
    needsTestReason: pilot && !testSkipComplete(subject.dailyTestSkip), // 일일 테스트 '없음'이면 사유 필수(2026-10-22)
    needsHomeworkReason: pilot && needsHomeworkMissReason(fields.homework, subject.homeworkMissReason), // 숙제 미제출 사유(2026-10-23)
    needsAttitudeNote: pilot && needsAttitudeNote(fields.attitude, subject.attitudeNote), // 태도 하·중하 의견 3줄(2026-10-26)
    needsMakeupCheck: needsMakeupCheck(subject), // 보강 예약이 든 줄은 보강 진행 여부 확인 뒤에(2026-10-27)
    readonlyView: args.readonlyView,
    // 회수 요청 뒤 워커가 옛 글을 지우기 전 — 지금 보내면 옛 글 옆에 새 글이 붙는다(예전엔 카드만 넘겼다, B5).
    recallPending: isRecallInFlight(liveStatus ?? null),
    // 발송 대기·게시 중 — 워커 결과 전까지 다시 못 누른다(원장 2026-09-29).
    sendInFlight: liveStatus === "queued" || liveStatus === "processing",
    alreadySent: isAlreadySent(liveStatus),
    reportOptout: isReportOptoutRow(subject), // 미발송 반(0174a)
    isAbsent: subject.attendanceRaw === "absent",
    hasProgress: isReportEligible(subject, progressOptional),
    // 멘트 = 학부모에게 나갈 글 — 영어 글의 그림·사진 자리 줄뿐이면 서버가 막으니 여기서도 '멘트 없음'.
    hasDraft: hasTextBesidesMarkers(rep?.draft),
    // 출결 쓰기 권한 없음 = 게이트 해당 없음(P0-3) — 알약도 없는데 "출결을 기록하라"는 거짓 안내 방지.
    attendanceUnchecked: !args.attendanceReadOnly && isAttendanceUnchecked(subject),
  });
}
