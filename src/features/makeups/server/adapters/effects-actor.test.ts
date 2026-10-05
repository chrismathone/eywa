import { DESK, KEY, TEACHER, m } from "./effects-test-double";
import { beforeEach, describe, expect, it } from "vitest";
import { participationCommandId } from "../../command-parse";
import { retryParticipationEffect, sendParticipation } from "./effects";

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

describe("참여 명령의 로그인 주체", () => {
  const payload = { status: "present", actual_teacher_id: TEACHER, taught_by: TEACHER };

  function commands() {
    return m.state.calls.filter((call) => call.name === "makeup_command");
  }

  it("다른 연산자는 다른 명령 id 를 쓰고 강사 귀속은 본문에 남긴다", async () => {
    m.state.claimsSub = TEACHER;
    await sendParticipation(KEY, payload);
    m.state.claimsSub = DESK;
    await sendParticipation(KEY, { taught_by: TEACHER, actual_teacher_id: TEACHER, status: "present" });
    const ids = commands().map((call) => call.args.p_command_id);
    expect(ids).toEqual([
      participationCommandId(KEY, payload, TEACHER),
      participationCommandId(KEY, payload, DESK),
    ]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(commands().map((call) => call.args.p_payload)).toEqual([payload, payload]);
    expect(commands().every((call) => call.args.p_action === "participation")).toBe(true);
  });

  it("같은 연산자의 키 순서만 다른 본문은 같은 명령 id 다", async () => {
    await sendParticipation(KEY, { actual_minutes: 60, status: "present", actual_teacher_id: TEACHER });
    await sendParticipation(KEY, { status: "present", actual_teacher_id: TEACHER, actual_minutes: 60 });
    const ids = commands().map((call) => call.args.p_command_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(participationCommandId(KEY, { status: "present", actual_teacher_id: TEACHER, actual_minutes: 60 }, TEACHER));
  });

  it("클레임이 비면 세션 사용자 id 를 주체로 쓴다", async () => {
    m.state.claimsSub = null;
    m.state.userId = DESK;
    const sent = await sendParticipation(KEY, payload);
    expect(sent.ok).toBe(true);
    expect(commands()[0]?.args.p_command_id).toBe(participationCommandId(KEY, payload, DESK));
    expect(commands()[0]?.args.p_command_id).not.toBe(participationCommandId(KEY, payload, TEACHER));
  });

  it("로그인 주체가 없으면 명령을 보내지 않는다", async () => {
    m.state.claimsSub = null;
    m.state.userThrow = true;
    const sent = await sendParticipation(KEY, payload);
    expect(sent).toEqual({ ok: false, error: "보강 참여를 저장하지 못했습니다" });
    expect(commands()).toEqual([]);
    m.state.userThrow = false;
    m.state.claimsThrow = true;
    m.state.evidence = [null, null];
    const retried = await retryParticipationEffect({ effectKey: KEY, participantId: "ffffffff-ffff-4fff-8fff-ffffffffffff", payload });
    expect(retried).toMatchObject({ state: "failed", commandAccepted: false });
    expect(m.state.calls.every((call) => call.name === "makeup_projection_evidence")).toBe(true);
  });
});
