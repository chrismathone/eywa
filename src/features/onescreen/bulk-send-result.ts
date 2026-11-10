/**
 * 표 일괄 발송의 **결과 세기**와 마지막 안내 문구(순수 · 수정 계획 P3-O batch D, `use-bulk-send.ts`에서 옮김 · 본문 그대로).
 * 부르는 쪽이 행마다 `add(res)`로 세고(순차 발송 그대로), 끝나면 `message(...)`로 한 줄을 만든다.
 * 서버가 거절한 이유는 '실패'로 뭉치지 않고 따로 센다(배정 대기 · 보낼 반 없음 · 새 보고서 조건 · 보강 확인 전).
 */
import { isBoardBlockedStatus, isBoardWaitStatus } from "./send-class";
import { isPilotGateError } from "./math-report-pilot";
import { MAKEUP_CHECK_REQUIRED_ERROR } from "@/features/attendance/makeup-check-error";
import type { SendCore } from "./components/use-bulk-send";
import type { useSheetTf } from "@/features/teacher-view/lang-context";

type QueueResult = Awaited<ReturnType<SendCore["queueOne"]>>;

export function createBulkSendTally() {
  let queued = 0;
  let blocked = 0;
  let skipped = 0;
  let subjectOff = 0; // 발송 대상 과목 아님(저장만) — '발송 대기'로 뭉뚱그리지 않고 명시(#2 확정)
  let absentSkip = 0; // 서버 결석 게이트에 걸린 행(클라 사전 필터의 사각 — 반 모호 행 등)
  let uncheckedSkip = 0; // 서버 출결 미체크 게이트에 걸린 행(stale 화면 등 클라 게이트 사각)
  let optoutSkip = 0; // 서버 '수업보고서 미발송' 반 게이트에 걸린 행(2026-08-19)
  let sentSkip = 0; // 서버 중복 게시 가드에 걸린 행(다른 창에서 먼저 보낸 경우 등)
  let dry = 0;
  let fail = 0;
  let noClass = 0; // 반별 발송인데 보낼 반이 없어 막힌 행(원장 2026-09-30 — 담당 반이 없으면 발송 불가)
  let boardWait = 0; // 반 보드 배정·재확인을 기다리는 행(방금 배정된 신입 등 — 배정된 뒤 다시 보내면 된다, 2026-10-03)
  let jjWarn = 0; // 영어 그림 자료를 못 묶은 행(저장은 성공)
  let makeupSkip = 0; // 보강 진행 여부 확인 전이라 서버가 거절한 행(저장은 됐다)
  let pilotSkip = 0; // 새 보고서 조건(자동작성·사랑의 한마디·사유)에 걸려 서버가 거절한 행 — 화면 판정 뒤에 값이 바뀐 경우
  let windowHint = ""; // 발송 허용 시간창 밖 큐잉 — 마지막 응답의 창 라벨(테넌트 단일 설정이라 동일)
  return {
    /** 한 행의 발송 응답을 센다(예전 루프 본문 그대로). */
    add(res: QueueResult) {
      if (res.ok && res.warning) jjWarn++;
      if (!res.ok) {
        // 반 보드에 배정되는 중이면 '실패'가 아니라 '기다림'으로 센다. 보류·반을 떠난 학생은 보낼 반이 없는 것이다.
        if (isBoardWaitStatus(res.status)) boardWait++;
        else if (res.status === "no_class" || isBoardBlockedStatus(res.status)) noClass++;
        // 새 보고서 조건에 걸려 서버가 거절(저장은 됐다) — '실패'로 뭉치지 않고 이유를 따로 센다(원장 2026-10-26).
        else if (isPilotGateError(res.error)) pilotSkip++;
        // 보강 진행 여부 확인 전(화면 판정 뒤에 예약이 생긴 경우 등) — 서버가 거절, 저장은 됐다.
        else if (res.error === MAKEUP_CHECK_REQUIRED_ERROR) makeupSkip++;
        else fail++;
      } else if (res.status === "queued") {
        queued++;
        if (res.sendWindowHint) windowHint = res.sendWindowHint;
      } else if (res.status === "dry_run") dry++;
      else if (res.status === "subject_off") subjectOff++;
      else if (res.status === "name_conflict" || res.status === "revoked" || res.status === "recall_pending") blocked++;
      else if (res.status === "absent") absentSkip++; // 서버 결석 게이트(클라 사전 필터를 지난 반 모호 행 등)
      else if (res.status === "no_attendance") uncheckedSkip++; // 서버 출결 미체크 게이트(stale 화면 등)
      else if (res.status === "report_optout") optoutSkip++; // 서버 미발송 반 게이트(2026-08-19)
      else if (res.status === "already_sent") sentSkip++; // 서버 중복 게시 가드(클라 게이트를 지난 stale 행)
      else skipped++; // processing/too_old
    },
    /** 마지막 안내 한 줄 — 일괄 발송 전에 이미 빠진 행(이미 발송·미리 제외)도 함께 적는다. */
    message(
      { classnoteOn, alreadySentRows, preSkipped }: { classnoteOn: boolean; alreadySentRows: number; preSkipped: number },
      tf: ReturnType<typeof useSheetTf>,
    ): string {
      return (
        (dry ? (classnoteOn ? tf("os.c.bulkDry", { n: dry }) : tf("os.c.bulkSavedOnly", { n: dry })) : "") +
          (!classnoteOn && queued === 0
            ? ""
            : windowHint
              ? tf("os.c.bulkQueuedWindow", { n: queued, hint: windowHint })
              : tf("os.c.bulkQueued", { n: queued })) +
          (subjectOff ? tf("os.c.bulkSubjectOff", { n: subjectOff }) : "") +
          (absentSkip ? tf("os.c.bulkAbsent", { n: absentSkip }) : "") +
          (uncheckedSkip ? tf("os.c.bulkUnchecked", { n: uncheckedSkip }) : "") +
          (optoutSkip ? tf("os.c.bulkOptout", { n: optoutSkip }) : "") +
          (alreadySentRows || sentSkip
            ? tf("os.c.bulkSent", { n: alreadySentRows + sentSkip })
            : "") +
          (blocked ? tf("os.c.bulkBlocked", { n: blocked }) : "") +
          (skipped ? tf("os.c.bulkSkipped", { n: skipped }) : "") +
          (preSkipped ? tf("os.c.bulkPreSkipped", { n: preSkipped }) : "") +
          (jjWarn ? tf("os.tpl.jjWarnBulk", { n: jjWarn }) : "") +
          (boardWait ? tf("os.c.bulkBoardWait", { n: boardWait }) : "") +
          (noClass ? tf("os.c.bulkNoClass", { n: noClass }) : "") +
          (pilotSkip ? tf("os.c.bulkPilot", { n: pilotSkip }) : "") +
          (makeupSkip ? tf("os.c.bulkMakeupCheck", { n: makeupSkip }) : "") +
          (fail ? tf("os.c.bulkFail", { n: fail }) : "")
      );
    },
  };
}
