import { describe, expect, it } from "vitest";
import { isMissingMakeupRpc, isModeOffError, nextParticipantPage, parseCommandSuccess, parseParticipantBody, participantCursor, participationCommandId, sameParticipantCursor, stableCommandId } from "./command-parse";

const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DESK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const success = {
  id: "11111111-1111-4111-8111-111111111111", revision: 2, replayed: false, effect_key: "legacy:1",
  action: "participation", case_id: null, session_id: null, participant_id: "p", fulfillment_id: null,
  case_ids: [], quantities: null, warnings: [],
};

describe("명령·참여 본문", () => {
  it("성공 키가 빠지면 실패다", () => {
    const { effect_key, ...rest } = success;
    expect(effect_key).toBe("legacy:1");
    expect(parseCommandSuccess(rest).ok).toBe(false);
    expect(parseCommandSuccess(success)).toMatchObject({ ok: true, value: { effect_key: "legacy:1", replayed: false } });
  });

  it("케이스 목록은 참여가 없다는 뜻이 아니고, 잘린 목록은 실패다", () => {
    expect(parseParticipantBody({ rows: [], total: 0 }).ok).toBe(false);
    expect(parseParticipantBody({ participants: [], legacy_maps: [], truncated: true })).toMatchObject({ ok: true, value: { truncated: true } });
    expect(nextParticipantPage([{ sessionDate: "2026-10-05" }, { sessionDate: "2026-10-06" }, { sessionDate: "2026-10-06" }], "2026-10-01")).toEqual({ keep: 1, nextFrom: "2026-10-06" });
    expect(nextParticipantPage([{ sessionDate: "2026-10-06" }, { sessionDate: "2026-10-06" }], "2026-10-06")).toBeNull();
    const cursor = participantCursor({ sessionDate: "2026-10-05", startTime: null, id: "p" });
    expect(cursor).toEqual({ session_date: "2026-10-05", start_time: "00:00", id: "p" });
    expect(sameParticipantCursor(cursor, { ...cursor })).toBe(true);
    const parsed = parseParticipantBody({
      participants: [{ id: "p", student_id: "s", subject_key: "math", session_date: "2026-10-05", class_id: "c", status: "present", case_ids: [] }],
      legacy_maps: [{ id: "m", legacy_reservation_id: "r", participant_id: "p", case_id: "k", effect_key: "e", state: "active" }],
    });
    expect(parsed.ok).toBe(true);
  });

  it("없는 함수와 운영 중지는 빈 성공이 아니다", () => {
    expect(isMissingMakeupRpc({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isModeOffError({ message: "mode_off" })).toBe(true);
    expect(stableCommandId("legacy:1")).toBe(stableCommandId("legacy:1"));
    const same = participationCommandId("att:p", { status: "present", actual_minutes: 60 }, ACTOR);
    expect(same).toBe(participationCommandId("att:p", { actual_minutes: 60, status: "present" }, ACTOR));
    expect(same).not.toBe(participationCommandId("att:p", { status: "present", actual_minutes: 40 }, ACTOR));
    expect(same).not.toBe(stableCommandId("att:p"));
    expect(same).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseCommandSuccess({ ...success, projection_state: "pending", verification: { ok: false, code: "evidence_required" } })).toMatchObject({
      ok: true, value: { projection_state: "pending", verification_code: "evidence_required", verification_ok: false },
    });
    expect(parseCommandSuccess({ ...success, projection_state: "done", verification: { ok: true } })).toMatchObject({
      ok: true, value: { projection_state: "done", verification_ok: true },
    });
  });

  it("같은 연산자와 같은 본문은 같은 명령이고, 다른 연산자와 빈 주체는 그렇지 않다", () => {
    const payload = { status: "present", actual_teacher_id: DESK, teacher_id: DESK, taught_by: DESK, actual_minutes: 60 };
    const reordered = { taught_by: DESK, actual_minutes: 60, teacher_id: DESK, status: "present", actual_teacher_id: DESK };
    const teacher = participationCommandId("att:p", payload, ACTOR);
    const desk = participationCommandId("att:p", payload, DESK);
    expect(teacher).toBe(participationCommandId("att:p", reordered, ACTOR));
    expect(teacher).not.toBe(desk);
    expect(teacher).not.toBe(participationCommandId("att:q", payload, ACTOR));
    expect(participationCommandId("att:p", { ...payload, actual_teacher_id: ACTOR }, ACTOR)).not.toBe(teacher);
    expect(participationCommandId("att:p", payload, "")).toBeNull();
    expect(participationCommandId("att:p", payload, "   ")).toBeNull();
  });
});
