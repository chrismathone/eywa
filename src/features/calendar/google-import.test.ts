import { describe, it, expect } from "vitest";
import {
  IMPORT_MEMO_PREFIX,
  LEGACY_SNAPSHOT_MEMO_PREFIX,
  canOverwrite,
  planDeletions,
  shiftYmd,
  stripHtml,
  toImportedRow,
  parseCalendarSources,
  UNTITLED_LABEL,
} from "./google-import";

const CAL = "02. 입학 상담_NEW";

describe("toImportedRow — 종일 일정", () => {
  // 🔴 실사고 예방: 구글 종일 종료는 **배타적**(다음 날)이다. 그대로 넣으면 하루 일정이 이틀이 된다.
  it("하루짜리 종일 일정의 끝날은 시작날과 같다", () => {
    const r = toImportedRow(
      { id: "a", summary: "인재원 특별반 학부모 설명회", start: { date: "2026-09-10" }, end: { date: "2026-09-11" } },
      CAL,
    );
    expect(r).toMatchObject({ startDate: "2026-09-10", endDate: "2026-09-10", startTime: null, endTime: null });
  });

  it("사흘짜리 종일 일정도 하루 당겨 포함 끝날로", () => {
    const r = toImportedRow({ id: "a", start: { date: "2026-09-23" }, end: { date: "2026-09-26" } }, CAL);
    expect(r?.endDate).toBe("2026-09-25");
  });

  it("끝이 없으면 시작날과 같은 하루로", () => {
    expect(toImportedRow({ id: "a", start: { date: "2026-09-10" } }, CAL)?.endDate).toBe("2026-09-10");
  });

  it("끝이 시작보다 앞서면 하루짜리로 바닥 — 거꾸로 된 구간을 만들지 않는다", () => {
    const r = toImportedRow({ id: "a", start: { date: "2026-09-10" }, end: { date: "2026-09-10" } }, CAL);
    expect(r?.endDate).toBe("2026-09-10");
  });
});

describe("toImportedRow — 시각 일정 (KST 환산)", () => {
  it("KST 오프셋이 붙어 오면 그대로 KST 날짜·시각", () => {
    const r = toImportedRow(
      {
        id: "b",
        summary: "[정유진] 영어레테 김리안(칠성초3)",
        start: { dateTime: "2026-09-10T16:00:00+09:00" },
        end: { dateTime: "2026-09-10T17:00:00+09:00" },
      },
      CAL,
    );
    expect(r).toMatchObject({ startDate: "2026-09-10", startTime: "16:00", endDate: "2026-09-10", endTime: "17:00" });
  });

  it("🔴 UTC로 와도 KST로 환산한다 — 밤 시간대가 하루 밀리면 안 된다", () => {
    // 2026-09-10T22:00Z = KST 2026-09-11 07:00
    const r = toImportedRow({ id: "c", start: { dateTime: "2026-09-10T22:00:00Z" } }, CAL);
    expect(r).toMatchObject({ startDate: "2026-09-11", startTime: "07:00" });
  });

  it("종료가 없으면 같은 날 + 종료시각은 비운다(지어내지 않는다)", () => {
    const r = toImportedRow({ id: "d", start: { dateTime: "2026-09-10T16:00:00+09:00" } }, CAL);
    expect(r).toMatchObject({ startDate: "2026-09-10", endDate: "2026-09-10", endTime: null });
  });

  it("자정 넘김도 끝 날짜가 따라간다", () => {
    const r = toImportedRow(
      { id: "e", start: { dateTime: "2026-09-10T23:00:00+09:00" }, end: { dateTime: "2026-09-11T01:00:00+09:00" } },
      CAL,
    );
    expect(r).toMatchObject({ startDate: "2026-09-10", endDate: "2026-09-11", endTime: "01:00" });
  });
});

describe("toImportedRow — 넣지 않는 것", () => {
  it("취소된 일정은 null", () => {
    expect(toImportedRow({ id: "x", status: "cancelled", start: { date: "2026-09-10" } }, CAL)).toBeNull();
  });
  it("id가 없으면 null — 외부 키가 없으면 다음 회차에 중복된다", () => {
    expect(toImportedRow({ summary: "제목만", start: { date: "2026-09-10" } }, CAL)).toBeNull();
  });
  it("날짜가 아예 없으면 null", () => {
    expect(toImportedRow({ id: "y", summary: "언제?" }, CAL)).toBeNull();
  });
});

describe("toImportedRow — 제목·메모", () => {
  it("제목이 비면 투명한 줄 대신 (제목 없는 일정)", () => {
    expect(toImportedRow({ id: "f", start: { date: "2026-09-10" } }, CAL)?.title).toBe(UNTITLED_LABEL);
  });

  it("메모 첫 줄에 출처 캘린더를 적는다", () => {
    expect(toImportedRow({ id: "g", start: { date: "2026-09-10" } }, CAL)?.memo).toContain(`구글 캘린더 · ${CAL}`);
  });

  it("구글 설명의 HTML은 벗겨서 담는다", () => {
    const r = toImportedRow(
      { id: "h", start: { date: "2026-09-10" }, description: "<h4><strong>&lt; EiE 영어 </strong></h4><br>첫 수업 절차" },
      CAL,
    );
    expect(r?.memo).toContain("< EiE 영어");
    expect(r?.memo).not.toContain("<h4>");
  });
});

describe("stripHtml", () => {
  // </p>와 <br>이 각각 줄바꿈이라 문단 구분(빈 줄 하나)이 남는다 — 원문 구조를 지우지 않는 게 맞다.
  it("태그를 지우고 엔티티를 되돌린다", () => {
    expect(stripHtml("<p>가&amp;나</p><br><div>다</div>")).toBe("가&나\n\n다");
  });
  it("평문은 그대로", () => {
    expect(stripHtml("그냥 설명")).toBe("그냥 설명");
  });
});

describe("canOverwrite — 사람이 고친 일정은 지킨다", () => {
  it("임포트 뒤에 사람이 고쳤으면 안 덮는다", () => {
    expect(
      canOverwrite({ googleSyncedAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T05:00:00Z" }),
    ).toBe(false);
  });

  it("임포트가 마지막이면 덮는다", () => {
    expect(
      canOverwrite({ googleSyncedAt: "2026-09-10T05:00:00Z", updatedAt: "2026-09-10T05:00:00Z" }),
    ).toBe(true);
  });

  it("google_synced_at이 없는 옛 행(9/3 스냅샷)은 덮는다", () => {
    expect(canOverwrite({ googleSyncedAt: null, updatedAt: "2026-09-03T08:40:00Z" })).toBe(true);
  });

  it("1초 이내 차이는 트리거 오차로 보고 덮는다", () => {
    expect(
      canOverwrite({ googleSyncedAt: "2026-09-10T05:00:00.000Z", updatedAt: "2026-09-10T05:00:00.400Z" }),
    ).toBe(true);
  });
});

describe("planDeletions", () => {
  it("구글에서 사라진 것만 지운다", () => {
    expect(planDeletions(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["b"]);
  });
  it("전부 그대로면 지울 것 없음", () => {
    expect(planDeletions(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });
});

describe("shiftYmd", () => {
  it("달·해를 넘는다", () => {
    expect(shiftYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftYmd("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("parseCalendarSources — 태그와 캘린더를 명시로 짝짓는다", () => {
  it("줄마다 태그이름|캘린더ID", () => {
    const v = parseCalendarSources("02. 입학 상담|a@g.com" + String.fromCharCode(10) + "05. 학원행사|b@g.com");
    expect(v).toEqual([
      { tagName: "02. 입학 상담", calendarId: "a@g.com" },
      { tagName: "05. 학원행사", calendarId: "b@g.com" },
    ]);
  });

  it("세미콜론 구분·공백도 받는다", () => {
    expect(parseCalendarSources(" 05. 학원행사 | b@g.com ; 06. 학사일정|c@g.com ")).toEqual([
      { tagName: "05. 학원행사", calendarId: "b@g.com" },
      { tagName: "06. 학사일정", calendarId: "c@g.com" },
    ]);
  });

  it("🔴 값이 없으면 빈 배열 — 목록을 모르면 아무 일도 안 한다(삭제 정리가 전부 지우는 것 방지)", () => {
    expect(parseCalendarSources(undefined)).toEqual([]);
    expect(parseCalendarSources("   ")).toEqual([]);
  });

  it("구분자 없는 줄은 버린다 — 태그 없이 들어오면 어느 태그인지 모른다", () => {
    expect(parseCalendarSources("a@g.com")).toEqual([]);
    expect(parseCalendarSources("|a@g.com")).toEqual([]);
  });

  it("캘린더 ID 안의 |는 없다고 보고 첫 구분자로만 자른다", () => {
    expect(parseCalendarSources("01. 운영팀 중요일정|x@group.calendar.google.com")[0]).toEqual({
      tagName: "01. 운영팀 중요일정",
      calendarId: "x@group.calendar.google.com",
    });
  });
});

describe("메모 접두 — 첫 회차 정리가 새 행을 잡아먹지 않는다", () => {
  it("🔴 옛 스냅샷 접두와 새 임포트 접두는 글자가 다르다", () => {
    expect(IMPORT_MEMO_PREFIX.startsWith(LEGACY_SNAPSHOT_MEMO_PREFIX)).toBe(false);
  });

  it("새로 만든 행의 메모는 옛 접두로 시작하지 않는다 — 정리 대상이 될 수 없다", () => {
    const r = toImportedRow({ id: "z", start: { date: "2026-09-10" } }, "05. 학원행사");
    expect(r?.memo?.startsWith(LEGACY_SNAPSHOT_MEMO_PREFIX)).toBe(false);
    expect(r?.memo?.startsWith(IMPORT_MEMO_PREFIX)).toBe(true);
  });
});
