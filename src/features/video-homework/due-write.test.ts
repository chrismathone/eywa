import { describe, expect, it, vi } from "vitest";
import { decideVideoHomeworkDue } from "./due-write";

// 원장 2026-10-15 — 영상 숙제 마감(7일 · 다음 수업). 10/12 = 월요일, 오늘 = 10/12(그날 쓴 보고서).
const base = {
  ready: true, videoHomework: true as boolean | undefined, mode: "next" as "week" | "next" | undefined, keptVideoHw: false, hasClass: true,
  owner: true, priorDue: null as string | null, reportDate: "2026-10-12", today: "2026-10-12",
};
const decide = (over: Partial<typeof base> = {}, next: () => Promise<string | null> = async () => "2026-10-15") =>
  decideVideoHomeworkDue({ ...base, ...over, resolveNext: next });

describe("영상 숙제 마감 — 저장이 무엇을 적나", () => {
  it("다음 수업 = 시간표로 찾은 날을 적는다 · 7일 = 지운다 · 과제를 끄면(마감을 안 보내도) 지운다", async () => {
    expect(await decide()).toEqual({ write: { video_homework_due: "2026-10-15" }, saved: { mode: "next", date: "2026-10-15" } });
    expect(await decide({ mode: "week" })).toEqual({ write: { video_homework_due: null }, saved: { mode: "week", date: null } });
    expect(await decide({ videoHomework: false, mode: undefined })).toEqual({ write: { video_homework_due: null } });
    // 고른 적 없음 = 건드리지 않는다(저장돼 있던 마감을 덮지 않게)
    expect(await decide({ mode: undefined })).toEqual({});
  });
  it("🔴 이미 정한 '다음 수업' 날짜는 다시 계산하지 않는다 — 학생에게 보인 날짜가 휴원·퇴원 예약으로 바뀌지 않게(시간표 조회 0)", async () => {
    const next = vi.fn(async () => "2026-10-16");
    expect(await decide({ priorDue: "2026-10-15" }, next)).toEqual({ saved: { mode: "next", date: "2026-10-15" } });
    expect(next).not.toHaveBeenCalled();
    // 쓸 수 없는 옛 값(범위 밖)은 없는 것과 같다 — 다시 찾는다
    expect(await decide({ priorDue: "2026-10-30" }, next)).toEqual({ write: { video_homework_due: "2026-10-16" }, saved: { mode: "next", date: "2026-10-16" } });
  });
  it("🔴 다음 수업을 못 찾음 · 이미 지남(늦게 쓴 보고서) → 7일로 적고 까닭을 돌려준다 · 시간표를 못 읽음 → 적지 않고 알린다", async () => {
    expect(await decide({}, async () => null)).toEqual({ write: { video_homework_due: null }, saved: { mode: "week", date: null, fellBack: "none" } });
    // 10/13(화) 보고서를 10/17에 쓰면 다음 수업 10/16(금)은 이미 지났다 — 지난 날로 고정하면 사이트에 안 뜨고 바로 미제출이 된다
    expect(await decide({ reportDate: "2026-10-13", today: "2026-10-17" }, async () => "2026-10-16"))
      .toEqual({ write: { video_homework_due: null }, saved: { mode: "week", date: null, fellBack: "past", missed: "2026-10-16" } });
    // 오늘이 다음 수업일이면 그날까지 낼 수 있다(지난 게 아니다)
    expect(await decide({ reportDate: "2026-10-13", today: "2026-10-16" }, async () => "2026-10-16"))
      .toEqual({ write: { video_homework_due: "2026-10-16" }, saved: { mode: "next", date: "2026-10-16" } });
    expect(await decide({}, async () => { throw new Error("timeout"); })).toEqual({ saved: { mode: "week", date: null, fellBack: "error" } });
  });
  it("🔴 남이 처음 쓴 줄은 적지 않는다 — 고른 값이 저장값과 다르면 저장값을 돌려준다(화면을 맞추고 잠근다) · 같으면 아무 말 없이", async () => {
    const next = vi.fn(async () => "2026-10-15");
    expect(await decide({ owner: false, mode: "week", priorDue: "2026-10-15" }, next)).toEqual({ saved: { mode: "next", date: "2026-10-15", kept: true } });
    expect(await decide({ owner: false, mode: "next", priorDue: null }, next)).toEqual({ saved: { mode: "week", date: null, kept: true } });
    expect(await decide({ owner: false, mode: "next", priorDue: "2026-10-15" }, next)).toEqual({});
    expect(await decide({ owner: false, videoHomework: false, mode: undefined, priorDue: "2026-10-15" }, next)).toEqual({});
    expect(next).not.toHaveBeenCalled();
  });
  it("칸이 없음(#95) · 영상 과제를 안 보냄 · 영상 과제 값을 둔 저장 · 반 없는 줄(보강)은 손대지 않는다", async () => {
    for (const over of [{ ready: false }, { videoHomework: undefined }, { keptVideoHw: true }, { hasClass: false }])
      expect(await decide(over), JSON.stringify(over)).toEqual({});
  });
});
