import { describe, expect, it } from "vitest";
import { rosterTextCols } from "@/features/class-sheets/lib/roster-form";
import {
  JJ_MARK_COLUMN,
  JJ_SEAT_COL_MIN_PX,
  JJ_MARK_FIELDS,
  JJ_MARK_MAXLEN,
  jjMarkLabel,
  jjSeatTextCols,
  parseJjMarkField,
  seatHasJjFields,
  jjClassColumns,
  seatOverlayKey,
} from "./jj-fields";

describe("JJ실 전용 칸", () => {
  it("로그인 JJ실만 전용 칸이 있다 — 랩실은 출결만", () => {
    expect(seatHasJjFields("jj")).toBe(true);
    expect(seatHasJjFields("lab")).toBe(false);
  });

  it("칸 구성은 영어 시트 JJ 폼과 같다 — 태도·듣기·단어·특이사항(원장 2026-09-03)", () => {
    expect([...JJ_MARK_FIELDS]).toEqual(["attitude", "listeningLevel", "memorizedWords", "progressNote"]);
    for (const f of JJ_MARK_FIELDS) expect(parseJjMarkField(f)).toBe(f);
    // 🔴 시험 점수는 JJ 폼에 없다(원장 2026-08-13) — 칸이 늘었다고 슬쩍 들어오면 안 된다.
    expect(parseJjMarkField("score")).toBeNull();
    // 🔴 컬럼 이름(`status`)은 저장 축이지 화면 키가 아니다 — 그대로 보내면 거절한다.
    expect(parseJjMarkField("status")).toBeNull();
    expect(parseJjMarkField("progress_note")).toBeNull();
  });

  it("태도는 marks의 status 컬럼 — 출결(attendance_records)과 다른 축이다", () => {
    expect(JJ_MARK_COLUMN.attitude).toBe("status");
    expect(JJ_MARK_COLUMN.progressNote).toBe("progress_note");
    expect(JJ_MARK_COLUMN.listeningLevel).toBe("listening_level");
    expect(JJ_MARK_COLUMN.memorizedWords).toBe("memorized_words");
  });

  it("길이 상한은 영어 시트(upsertStudentMark)와 같은 값 — 갈리면 한쪽에서만 저장된다", () => {
    expect(JJ_MARK_MAXLEN.attitude).toBe(50);
    expect(JJ_MARK_MAXLEN.progressNote).toBe(500);
    expect(JJ_MARK_MAXLEN.listeningLevel).toBe(30);
    expect(JJ_MARK_MAXLEN.memorizedWords).toBe(30);
  });

  it("에러 문구에 raw 컬럼명이 아니라 화면 라벨이 나간다", () => {
    expect(jjMarkLabel("attitude")).toBe("태도");
    expect(jjMarkLabel("progressNote")).toBe("특이사항");
    expect(jjMarkLabel("listeningLevel")).toBe("듣기 레벨");
    expect(jjMarkLabel("memorizedWords")).toBe("누적 암기 단어수");
  });

  it("자유 입력 열은 ECS JJ 폼과 **같은 배열**(태도·특이사항은 고정 칸이라 여기 없다)", () => {
    expect(jjSeatTextCols()).toBe(rosterTextCols("selfStudy"));
    expect(jjSeatTextCols().map((c) => c.label)).toEqual(["듣기 레벨", "누적 암기 단어수"]);
  });

  it("오버레이 키에 교시가 들어간다 — 없으면 다른 교시 값이 묻는다", () => {
    expect(seatOverlayKey("c1", "s1", "16:20:00")).toBe("c1|s1|16:20");
    expect(seatOverlayKey("c1", "s1", "16:20")).not.toBe(seatOverlayKey("c1", "s1", "17:20"));
  });
});

describe("JJ실 반 = 열", () => {
  it("반 수만큼 열을 만들고 빈 칸을 만들지 않는다", () => {
    // ⚠️ 하한은 여섯 칸(이름·출결·태도·듣기·단어·특이사항)이 **읽히는** 폭이다.
    //    🔴 리터럴로 적지 말 것 — 글자 크기가 바뀌면 이 값도 바뀐다(2026-09-08에 340이 v5 글자에서
    //    「결석 사유」를 못 담아 440으로 올렸는데, 그때 이 가드가 리터럴이라 함께 늙어 있었다).
    const w = JJ_SEAT_COL_MIN_PX;
    expect(jjClassColumns(1)).toBe(`repeat(1, minmax(min(100%, ${w}px), 1fr))`);
    expect(jjClassColumns(2)).toBe(`repeat(2, minmax(min(100%, ${w}px), 1fr))`);
    expect(jjClassColumns(3)).toBe(`repeat(3, minmax(min(100%, ${w}px), 1fr))`);
    expect(jjClassColumns(0)).toBe(`repeat(1, minmax(min(100%, ${w}px), 1fr))`);
    // 🔑 min(100%) — 폰에서 열이 화면보다 넓어지면 출결을 찍는 데도 가로로 끌어야 한다.
    expect(jjClassColumns(2, 440)).toBe("repeat(2, minmax(min(100%, 440px), 1fr))");
  });
});
