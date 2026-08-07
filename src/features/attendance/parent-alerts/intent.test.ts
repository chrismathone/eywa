import { describe, expect, it } from "vitest";
import {
  attendanceCategoryLabel,
  buildAttendanceAlert,
  buildClassifyPrompt,
  describeWhen,
  isAttendanceIntent,
  normalizeIntent,
} from "./intent";

const DAY = "2026-08-06";

describe("normalizeIntent — 모델 출력 후검증", () => {
  it("정상 결석 통보를 그대로 통과시킨다", () => {
    const r = normalizeIntent({ category: "absence", startsOn: "2026-08-06", endsOn: "2026-08-06", detail: "감기" }, { messageDate: DAY });
    expect(r).toEqual({ category: "absence", startsOn: "2026-08-06", endsOn: "2026-08-06", detail: "감기", dateAssumed: false });
  });

  it("기간 결석(며칠~며칠)을 유지한다", () => {
    const r = normalizeIntent({ category: "absence", startsOn: "2026-08-08", endsOn: "2026-08-18", detail: "가족여행" }, { messageDate: DAY });
    expect(describeWhen(r)).toBe("8/8~8/18");
  });

  it("모르는 카테고리는 none으로 떨어뜨린다(알리지 않음)", () => {
    for (const c of ["결석", "ABSENCE", "sick", "", null, undefined, 42]) {
      expect(normalizeIntent({ category: c, startsOn: DAY }, { messageDate: DAY }).category).toBe("none");
    }
  });

  it("none이면 날짜·사유를 싣지 않는다", () => {
    const r = normalizeIntent({ category: "none", startsOn: DAY, detail: "감사합니다" }, { messageDate: DAY });
    expect(r).toEqual({ category: "none", startsOn: null, endsOn: null, detail: null, dateAssumed: false });
  });

  // 🔴 연도 환각 — 실제로 흔한 실패. 지난해 날짜가 통과하면 "오늘 결석"이 명단에서 사라진다.
  it("상식 범위를 벗어난 날짜는 버리고 연락일로 대체하며 추정 표시를 남긴다", () => {
    const past = normalizeIntent({ category: "absence", startsOn: "2025-08-06" }, { messageDate: DAY });
    expect(past.startsOn).toBe(DAY);
    expect(past.dateAssumed).toBe(true);
    const far = normalizeIntent({ category: "absence", startsOn: "2027-01-01" }, { messageDate: DAY });
    expect(far.startsOn).toBe(DAY);
    expect(far.dateAssumed).toBe(true);
  });

  it("어제까지는 인정한다(어제 일을 오늘 알리는 연락)", () => {
    const r = normalizeIntent({ category: "absence", startsOn: "2026-08-05" }, { messageDate: DAY });
    expect(r.startsOn).toBe("2026-08-05");
    expect(r.dateAssumed).toBe(false);
  });

  it("형식이 아닌 날짜는 무시한다", () => {
    const r = normalizeIntent({ category: "late", startsOn: "8월 6일", endsOn: "내일" }, { messageDate: DAY });
    expect(r.startsOn).toBe(DAY);
    expect(r.dateAssumed).toBe(true);
  });

  it("종료만 있으면 시작으로 승격한다", () => {
    const r = normalizeIntent({ category: "absence", startsOn: null, endsOn: "2026-08-10" }, { messageDate: DAY });
    expect(r.startsOn).toBe("2026-08-10");
    expect(r.endsOn).toBe("2026-08-10");
    expect(r.dateAssumed).toBe(false);
  });

  it("거꾸로 된 기간은 하루짜리로 접는다", () => {
    const r = normalizeIntent({ category: "absence", startsOn: "2026-08-10", endsOn: "2026-08-07" }, { messageDate: DAY });
    expect(r.startsOn).toBe("2026-08-10");
    expect(r.endsOn).toBe("2026-08-10");
  });

  it("사유는 공백 정리 + 60자 컷", () => {
    expect(normalizeIntent({ category: "late", detail: "  감기   기운  " }, { messageDate: DAY }).detail).toBe("감기 기운");
    expect(normalizeIntent({ category: "late", detail: "가".repeat(80) }, { messageDate: DAY }).detail).toHaveLength(61);
  });

  it("입력이 통째로 쓰레기여도 터지지 않는다", () => {
    expect(normalizeIntent(null, { messageDate: DAY }).category).toBe("none");
    expect(normalizeIntent("문자열", { messageDate: DAY }).category).toBe("none");
  });
});

describe("알림 문구", () => {
  it("제목에 학생·분류·기간, 본문에 원문을 싣는다", () => {
    const intent = normalizeIntent({ category: "absence", startsOn: "2026-08-06", detail: "감기" }, { messageDate: DAY });
    const { title, body } = buildAttendanceAlert({
      studentName: "이시우",
      intent,
      content: "시우가 오늘 감기때문에\n몸이 좋지 않아서 학원을 하루 쉬겠습니다",
    });
    expect(title).toBe("이시우 결석 8/6");
    expect(body).toContain("감기");
    expect(body).toContain("학원을 하루 쉬겠습니다"); // 🔴 원문이 반드시 실린다
    expect(body).not.toContain("\n");
  });

  it("날짜를 가정했으면 제목이 그 사실을 밝힌다", () => {
    const intent = normalizeIntent({ category: "early_leave" }, { messageDate: DAY });
    expect(buildAttendanceAlert({ studentName: "김민준", intent, content: "일찍 데려갈게요" }).title).toBe(
      "김민준 조퇴 8/6(연락일 기준)",
    );
  });

  it("긴 원문은 자르되 잘렸음을 표시한다", () => {
    const intent = normalizeIntent({ category: "absence", startsOn: DAY }, { messageDate: DAY });
    const body = buildAttendanceAlert({ studentName: "가", intent, content: "나".repeat(400) }).body;
    expect(body).toContain("…");
    expect(body.length).toBeLessThan(240);
  });

  it("라벨은 한글이다(raw enum 노출 금지)", () => {
    expect(attendanceCategoryLabel("absence")).toBe("결석");
    expect(attendanceCategoryLabel("late")).toBe("지각");
    expect(attendanceCategoryLabel("early_leave")).toBe("조퇴");
  });

  it("none은 알림 대상이 아니다", () => {
    expect(isAttendanceIntent({ category: "none" })).toBe(false);
    expect(isAttendanceIntent({ category: "late" })).toBe(true);
  });
});

describe("buildClassifyPrompt", () => {
  const prompt = buildClassifyPrompt([{ id: "abc", studentName: "최연재", date: DAY, content: "오늘 못갈것 같아요" }]);

  it("연락일을 함께 넘긴다(상대 표현 해석의 축)", () => {
    expect(prompt).toContain(DAY);
    expect(prompt).toContain("연락일 기준");
  });

  it("4분류와 id 회신 규약을 명시한다", () => {
    for (const c of ["absence", "late", "early_leave", "none"]) expect(prompt).toContain(c);
    expect(prompt).toContain("id=abc");
  });

  it("확실하지 않으면 none이라는 지침을 유지한다(없는 결석을 만들지 않기)", () => {
    expect(prompt).toContain("확실하지 않으면 none");
  });

  it("본문은 600자에서 자른다(프롬프트 폭주 방지)", () => {
    const long = buildClassifyPrompt([{ id: "x", studentName: "가", date: DAY, content: "나".repeat(2000) }]);
    expect(long.length).toBeLessThan(3000);
  });
});
