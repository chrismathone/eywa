import { describe, expect, it } from "vitest";
import { createBulkSendTally } from "./bulk-send-result";
import { MAKEUP_CHECK_REQUIRED_ERROR } from "@/features/attendance/makeup-check-error";

const tf = ((k: string, p: Record<string, string | number>) => `${k}:${p.n}${p.hint ? `@${p.hint}` : ""}|`) as never;

describe("createBulkSendTally — 일괄 발송 결과 세기", () => {
  it("결과 코드마다 따로 세고 마지막 한 줄에 적는다(배정 대기·보강 확인 전은 '실패'가 아니다)", () => {
    const tally = createBulkSendTally();
    tally.add({ ok: true, status: "queued", sendWindowHint: "18시" });
    tally.add({ ok: true, status: "queued", warning: "그림" });
    tally.add({ ok: false, status: "board_enrolling" });
    tally.add({ ok: false, error: MAKEUP_CHECK_REQUIRED_ERROR });
    tally.add({ ok: false, error: "x" });
    tally.add({ ok: true, status: "already_sent" });
    const msg = tally.message({ classnoteOn: true, alreadySentRows: 1, preSkipped: 2 }, tf);
    expect(msg).toBe(
      "os.c.bulkQueuedWindow:2@18시|os.c.bulkSent:2|os.c.bulkPreSkipped:2|os.tpl.jjWarnBulk:1|os.c.bulkBoardWait:1|os.c.bulkMakeupCheck:1|os.c.bulkFail:1|",
    );
  });
  it("ClassNote 기능이 꺼진 학원은 dry_run을 '저장만'으로 · 대기 0이면 대기 문구를 뺀다", () => {
    const tally = createBulkSendTally();
    tally.add({ ok: true, status: "dry_run" });
    expect(tally.message({ classnoteOn: false, alreadySentRows: 0, preSkipped: 0 }, tf)).toBe("os.c.bulkSavedOnly:1|");
  });
});
