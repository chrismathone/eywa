import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attendanceCategoryLabel,
  buildAttendanceAlert,
  buildClassifyPrompt,
  describeWhen,
  isAttendanceIntent,
  normalizeIntent,
  parentMessageOrigin,
  uncoveredDatesIn,
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

// 🔴 2026-08-07 실사고 — "8월 7일 (오늘) 이랑 8월 11일, 8월 12일"이 `8/12` 하나로 굳어
//    벨 제목에서 **오늘 결석이 사라졌다**. 표가 단일 구간이라 흩어진 날짜를 못 담는다.
describe("판정이 못 담은 원문 날짜(uncoveredDatesIn)", () => {
  const FRI = "2026-08-07";

  it("흩어진 복수 날짜 중 판정 밖의 날을 이른 순으로 돌려준다", () => {
    const r = uncoveredDatesIn("저 8월 7일 (오늘) 이랑 8월 11일, 8월 12일에 개인일정으로 학원 못 옵니다.", {
      startsOn: "2026-08-12",
      endsOn: "2026-08-12",
    }, { messageDate: FRI });
    expect(r).toEqual(["8/7", "8/11"]);
  });

  it("판정이 그 날들을 이미 담고 있으면 조용하다", () => {
    expect(
      uncoveredDatesIn("8월 7일부터 8월 12일까지 못 갑니다", { startsOn: "2026-08-07", endsOn: "2026-08-12" }, { messageDate: FRI }),
    ).toEqual([]);
  });

  it("달 없는 맨 '3일'은 날짜로 보지 않는다 — 실제 문장 \"보강은 3일을 해야되니\"", () => {
    expect(
      uncoveredDatesIn("오늘도 아파서 결석해야될 것 같아요. 그리고 보강은 3일을 해야되니 어떻게 할까요?", {
        startsOn: FRI,
        endsOn: FRI,
      }, { messageDate: FRI }),
    ).toEqual([]);
  });

  it("앞에 달이 나온 뒤의 '12일'은 그 달을 승계한다", () => {
    expect(uncoveredDatesIn("8월 11일, 12일 결석합니다", { startsOn: "2026-08-11", endsOn: "2026-08-11" }, { messageDate: FRI })).toEqual([
      "8/12",
    ]);
  });

  it("8/12 같은 슬래시 표기도 읽는다", () => {
    expect(uncoveredDatesIn("8/11, 8/12 못 가요", { startsOn: "2026-08-11", endsOn: "2026-08-11" }, { messageDate: FRI })).toEqual(["8/12"]);
  });

  it("지난 일·먼 미래(연도 환각)는 셔틀에 쓸모없으므로 버린다", () => {
    expect(uncoveredDatesIn("지난 7월 3일에 못 갔었는데", { startsOn: FRI, endsOn: FRI }, { messageDate: FRI })).toEqual([]);
    expect(uncoveredDatesIn("12월 25일 크리스마스", { startsOn: FRI, endsOn: FRI }, { messageDate: FRI })).toEqual([]);
  });

  it("연락일이 없으면(형식 밖) 아무것도 지어내지 않는다", () => {
    expect(uncoveredDatesIn("8월 11일", { startsOn: null, endsOn: null }, { messageDate: "" })).toEqual([]);
  });

  // 🔴 날짜를 **고쳐 쓰지 않는다** — 판정을 원문의 이른 날로 당기면 "7일 보강 될까요? 12일은 결석"에서
  //    오늘을 결석으로 만들어 셔틀이 아이를 두고 간다. 알리기만 한다.
  it("알림은 판정 날짜를 바꾸지 않고 '확인'만 붙인다", () => {
    const intent = normalizeIntent({ category: "absence", startsOn: "2026-08-12", endsOn: "2026-08-12", detail: "개인일정" }, { messageDate: FRI });
    const { title, body } = buildAttendanceAlert({
      studentName: "이수빈",
      intent,
      content: "저 8월 7일 (오늘) 이랑 8월 11일, 8월 12일에 개인일정으로 학원 못 옵니다.",
      messageDate: FRI,
    });
    expect(title).toContain("이수빈 결석 8/12");
    expect(title).toContain("8/7·8/11 확인");
    expect(body).toContain("원문에 8/7·8/11 날짜도 있음");
    expect(body).toContain("원문: “"); // 원문은 그대로(글/댓글·반을 모르면 '원문')
  });

  // 원장 2026-11-04: 학생이 직접 단 댓글이 '학부모'로 떴다 — 작성자 칸이 없으니 '학부모'라고 적지 않고,
  // 어느 반 보드의 글인지 댓글인지를 적는다.
  it("원문 앞머리 = ‹반› 보드에 글 작성/댓글 · '학부모'라고 적지 않는다", () => {
    const intent = normalizeIntent({ category: "absence", startsOn: FRI, endsOn: FRI, detail: "팔이 아파서" }, { messageDate: FRI });
    const comment = buildAttendanceAlert({
      studentName: "김동리",
      intent,
      content: "선생님 저 팔이 넘 아파서 쉴게요",
      messageDate: FRI,
      source: "comment",
      className: "Green 초등 브릿지C (월수목)",
    });
    expect(comment.body).toBe("팔이 아파서 · Green 초등 브릿지C (월수목) 보드에 댓글: “선생님 저 팔이 넘 아파서 쉴게요”");
    expect(comment.body).not.toContain("학부모");
    const post = buildAttendanceAlert({ studentName: "김동리", intent, content: "오늘 결석합니다", source: "post", className: "중등M 중2 A" });
    expect(post.body).toContain("중등M 중2 A 보드에 글 작성: “오늘 결석합니다”");
    // 1인 보드 이름 = `(수학)학생이름` — '보드에'가 없으면 "김동리가 쓴 댓글"로 읽힌다(그 보드엔 학부모도 쓴다).
    const personal = buildAttendanceAlert({ studentName: "김동리", intent, content: "오늘 쉬어요", source: "comment", className: "(수학)김동리" });
    expect(personal.body).toContain("(수학)김동리 보드에 댓글: “오늘 쉬어요”");
  });

  it("parentMessageOrigin — 반이 없으면 종류만 · 종류를 모르면 '원문' · 공백은 하나로", () => {
    expect(parentMessageOrigin("comment", null)).toBe("댓글");
    expect(parentMessageOrigin("post", "  중등M   중2 A ")).toBe("중등M 중2 A 보드에 글 작성");
    expect(parentMessageOrigin(undefined, "중등M 중2 A")).toBe("중등M 중2 A 보드 원문");
    expect(parentMessageOrigin("something", "")).toBe("원문");
  });

  // 배선 가드(리뷰 2026-11-04) — 알림 스윕이 두 칸을 안 읽거나 안 넘기면 모든 벨이 조용히 '원문: “…”'으로 바뀐다.
  it("알림 스윕(server/classify.ts)이 source·class_name을 읽어 벨 문구로 넘긴다", () => {
    const src = readFileSync(join(process.cwd(), "src/features/attendance/parent-alerts/server/classify.ts"), "utf8");
    const columns = src.match(/const COLUMNS = "([^"]*)"/)?.[1] ?? "";
    expect(columns.split(",").map((c) => c.trim())).toEqual(expect.arrayContaining(["source", "class_name"]));
    expect(src).toContain("source: row.source ?? null");
    expect(src).toContain("className: row.class_name ?? null");
  });

  it("담을 게 없으면 제목이 지금까지와 같다(잡음 안 늘린다)", () => {
    const intent = normalizeIntent({ category: "absence", startsOn: FRI, endsOn: FRI, detail: "가족여행" }, { messageDate: FRI });
    const { title } = buildAttendanceAlert({
      studentName: "최연재",
      intent,
      content: "가족여행일정이 늘어나서 부득이하게 오늘 학원에 못갈것같아요",
      messageDate: FRI,
    });
    expect(title).toBe("최연재 결석 8/7");
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
