import { ATT, KEY, PART, TEACHER, m } from "./effects-test-double";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptedEffectGap } from "../../effect-gap";
import { judgeSqlProjection, parseSqlProjection } from "../../projection-evidence";
import { noteEffectGap, retryParticipationEffect } from "./effects";

const gap = { effectKey: KEY, kind: "participation_pending", participantId: PART, reservationId: null, error: "대기" };
const ready = {
  state: "done", verification: { ok: true },
  evidence: { attendance_record_id: ATT, session_units: 0.5, taught_by: TEACHER, actual_teacher_id: TEACHER },
};

beforeEach(() => {
  m.state.calls = [];
  m.state.gap = "ok";
  m.state.evidence = [];
  m.state.commandError = false;
  m.state.claimsSub = TEACHER;
  m.state.userId = null;
  m.state.claimsThrow = false;
  m.state.userThrow = false;
});

describe("반영 실패 기록", () => {
  it("같은 effect 와 kind 를 다시 적어도 본문이 맞으면 대기열에 들어간다", async () => {
    const first = await noteEffectGap(gap);
    const second = await noteEffectGap(gap);
    expect(first.queued).toBe(true);
    expect(second.queued).toBe(true);
    expect(m.state.calls.map((call) => call.args.p_gap)).toEqual([
      expect.objectContaining({ effect_key: KEY, kind: "participation_pending" }),
      expect.objectContaining({ effect_key: KEY, kind: "participation_pending" }),
    ]);
  });

  it("빈 응답·거절·식별자 없음·다른 kind 는 성공이 아니다", async () => {
    expect(acceptedEffectGap(null, { effectKey: KEY, kind: "participation_pending" })).toBe(false);
    expect(acceptedEffectGap({ queued: true }, { effectKey: KEY, kind: "participation_pending" })).toBe(false);
    expect(acceptedEffectGap(
      { queued: true, id: "1", effect_key: KEY, kind: "other" },
      { effectKey: KEY, kind: "participation_pending" },
    )).toBe(false);
    m.state.gap = "null";
    expect((await noteEffectGap(gap)).queued).toBe(false);
    m.state.gap = "error";
    expect((await noteEffectGap(gap)).queued).toBe(false);
  });
});

describe("반영 재시도", () => {
  it("증거가 done 이고 ok 이면 명령을 다시 보내지 않는다", async () => {
    m.state.evidence = [ready];
    const out = await retryParticipationEffect({ effectKey: KEY, participantId: PART, payload: { status: "present" } });
    expect(out.state).toBe("done");
    expect(m.state.calls.map((call) => call.name)).toEqual(["makeup_projection_evidence"]);
  });

  it("빈 응답·부분 증거·실패 상태는 완료가 아니고 시수 함수를 부르지 않는다", async () => {
    expect(judgeSqlProjection(parseSqlProjection(null)).state).toBe("pending");
    expect(judgeSqlProjection(parseSqlProjection({ state: "done", verification: { ok: true }, evidence: { session_units: 1 } })).state).toBe("pending");
    expect(judgeSqlProjection(parseSqlProjection({ state: "failed", verification: { ok: false }, evidence: {} })).state).toBe("failed");
    m.state.evidence = [null, { state: "pending", verification: { ok: false }, evidence: {} }];
    const pending = await retryParticipationEffect({ effectKey: KEY, participantId: PART, payload: { status: "present" } });
    expect(pending.state).toBe("pending");
    expect(pending.commandAccepted).toBe(true);
    m.state.evidence = [null, { state: "failed", verification: { ok: false }, evidence: {} }];
    const failed = await retryParticipationEffect({ effectKey: KEY, participantId: PART, payload: { status: "present" } });
    expect(failed.state).toBe("failed");
    m.state.commandError = true;
    m.state.evidence = [null, null];
    const rejected = await retryParticipationEffect({ effectKey: KEY, participantId: PART, payload: { status: "present" } });
    expect(rejected).toMatchObject({ state: "failed", commandAccepted: false });
    expect(m.state.calls.every((call) => call.name === "makeup_projection_evidence" || call.name === "makeup_command")).toBe(true);
  });

  it("이미 끝난 증거는 로그인 주체가 없어도 명령을 다시 보내지 않는다", async () => {
    m.state.claimsSub = null;
    m.state.evidence = [ready];
    const out = await retryParticipationEffect({ effectKey: KEY, participantId: PART, payload: { status: "present" } });
    expect(out.state).toBe("done");
    expect(m.state.calls.map((call) => call.name)).toEqual(["makeup_projection_evidence"]);
  });
});
