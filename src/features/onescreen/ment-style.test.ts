import { describe, expect, it } from "vitest";
import {
  MENT_STYLE_MAX_EDITED,
  MENT_STYLE_MAX_SAMPLES,
  corpusUntil,
  isMentStyleTableMissingError,
  keepRecurringPhrases,
  parseMentStyleProfile,
  pickStyleSamples,
  profileMentionsAny,
  styleCorpusHash,
  type StyleSampleRow,
} from "./ment-style";
import { MENT_STYLE_DIRECTIVE_HEAD, MENT_STYLE_PROMPT_VERSION, buildMentStylePrompt, mentStyleDirective } from "./ment-style-prompt";

const row = (id: string, notes: string, source: StyleSampleRow["source"] = "manual", day = 10): StyleSampleRow => ({
  id,
  notes,
  source,
  createdAt: `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  studentId: `st-${id}`,
});

describe("pickStyleSamples — 표본 고르기", () => {
  it("짧은 조각·빈 글·첨부 줄·그림 자리 줄만 있는 글은 뺀다", () => {
    const out = pickStyleSamples([
      row("a", "완료"),
      row("b", ""),
      row("c", "[첨부: 사진.jpg]"),
      row("d", "[시험결과지]\n[학습분석지]"),
      row("e", "오늘은 일차방정식 활용을 마무리했습니다.\n[시험결과지]"),
    ]);
    expect(out.map((s) => s.id)).toEqual(["e"]);
    expect(out[0]?.text).toBe("오늘은 일차방정식 활용을 마무리했습니다.");
  });
  it("같은 글은 한 번만(공백·줄바꿈 차이는 같은 글)", () => {
    const out = pickStyleSamples([row("a", "기출 2회 풀어오기"), row("b", "기출 2회  풀어오기\n"), row("c", "기출 2회 풀어오기")]);
    expect(out).toHaveLength(1);
  });
  it("직접 작성이 앞(최신 순), 자동작성 후 수정은 뒤에 상한만큼", () => {
    const rows: StyleSampleRow[] = [];
    for (let i = 0; i < 30; i++) rows.push(row(`e${i}`, `수정한 멘트 번호 ${i} 입니다.`, "auto_edited", (i % 28) + 1));
    rows.push(row("m1", "직접 쓴 오래된 멘트입니다.", "manual", 1));
    rows.push(row("m2", "직접 쓴 최신 멘트입니다.", "manual", 20));
    const out = pickStyleSamples(rows);
    expect(out[0]?.id).toBe("m2");
    expect(out[1]?.id).toBe("m1");
    expect(out.filter((s) => s.source === "auto_edited")).toHaveLength(MENT_STYLE_MAX_EDITED);
  });
  it("직접 작성이 넘쳐도 수정본 자리는 먼저 확보한다('둘 다' — 원장 문구)", () => {
    const rows: StyleSampleRow[] = [];
    for (let i = 0; i < MENT_STYLE_MAX_SAMPLES + 20; i++) rows.push(row(`m${i}`, `직접 쓴 멘트 번호 ${i} 입니다.`));
    for (let i = 0; i < 5; i++) rows.push(row(`e${i}`, `고친 멘트 번호 ${i} 입니다.`, "auto_edited"));
    const out = pickStyleSamples(rows);
    expect(out).toHaveLength(MENT_STYLE_MAX_SAMPLES);
    expect(out.filter((s) => s.source === "auto_edited")).toHaveLength(5);
    expect(out.filter((s) => s.source === "manual")).toHaveLength(MENT_STYLE_MAX_SAMPLES - 5);
  });
  it("같은 시각은 id로 갈라 결정적(같은 코퍼스 = 같은 지문)", () => {
    const a = pickStyleSamples([row("b", "둘째 멘트입니다."), row("a", "첫째 멘트입니다.")]);
    const b = pickStyleSamples([row("a", "첫째 멘트입니다."), row("b", "둘째 멘트입니다.")]);
    expect(a.map((s) => s.id)).toEqual(["a", "b"]);
    expect(styleCorpusHash(a, MENT_STYLE_PROMPT_VERSION)).toBe(styleCorpusHash(b, MENT_STYLE_PROMPT_VERSION));
  });
  it("지문은 프롬프트 버전을 섞는다 — 표본이 같아도 규칙을 고치면 다시 접는다", () => {
    const s = pickStyleSamples([row("a", "첫째 멘트입니다.")]);
    expect(styleCorpusHash(s, 2)).not.toBe(styleCorpusHash(s, 3));
    expect(styleCorpusHash(s, 2)).toMatch(/^v2-1-/);
  });
  it("corpusUntil = 표본 중 가장 최근 작성 시각", () => {
    const out = pickStyleSamples([row("a", "첫 번째 멘트입니다.", "manual", 3), row("b", "두 번째 멘트입니다.", "manual", 9)]);
    expect(corpusUntil(out)).toBe("2026-09-09T10:00:00.000Z");
    expect(corpusUntil([])).toBeNull();
  });
});

describe("parseMentStyleProfile — AI 응답 검증", () => {
  it("어조·문장이 비면 null(저장 안 함)", () => {
    expect(parseMentStyleProfile(null)).toBeNull();
    expect(parseMentStyleProfile({ tone: "", sentence: "짧게" })).toBeNull();
    expect(parseMentStyleProfile({ tone: "합니다체", sentence: 3 })).toBeNull();
  });
  it("숫자가 들었거나 긴 표현은 자르지 않고 버리고(내용이 섞인 어구), 중복·상한을 지킨다", () => {
    const p = parseMentStyleProfile({
      tone: "  담백한 합니다체  ",
      sentence: "짧게 끊는다",
      phrases: [
        "다음 시간에",
        "18/20 맞음",
        "다음 시간에",
        "3단원",
        "풀어오기",
        7,
        "",
        "오늘 대표원장님의 학습 설명회가 있었습니다 — 그날의 사건", // 상한 초과 = 내용 → 통째로 버린다(자르면 반쪽 문장이 남는다)
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ],
    });
    expect(p?.tone).toBe("담백한 합니다체");
    expect(p?.phrases).toEqual(["다음 시간에", "풀어오기", "a", "b", "c", "d", "e", "f"]);
    expect(p?.length).toBe("");
    expect(p?.caution).toBe("");
  });
  it("프롬프트의 줄바꿈 기호(⏎)가 응답에 되돌아오면 뗀다(드라이런: '줄바꿈(⏎) 이후에 과제 안내')", () => {
    const p = parseMentStyleProfile({ tone: "합니다체", sentence: "줄바꿈(⏎) 이후에 과제 안내 ⏎ 를 배치" });
    expect(p?.sentence).toBe("줄바꿈 이후에 과제 안내 를 배치");
  });
});

describe("keepRecurringPhrases — 표본에 되풀이되는 표현만", () => {
  const samples = pickStyleSamples([
    row("a", "오늘 진도 마무리했습니다. 다음 시간에 마무리하겠습니다."),
    row("b", "기출 풀어오기. 다음 시간에  마무리하겠습니다."),
    row("c", "오늘 대표원장님의 학습 설명회가 있었습니다."),
  ]);
  const base = parseMentStyleProfile({
    tone: "합니다체",
    sentence: "짧게",
    phrases: ["다음 시간에 마무리하겠습니다", "학습 설명회가 있었습니다", "풀어오기", "없는 어구"],
  })!;
  it("2개 이상 표본에 있는 어구만(공백 차이는 같은 어구), 한 번 나온 사건·없는 어구는 버린다", () => {
    expect(keepRecurringPhrases(base, samples).phrases).toEqual(["다음 시간에 마무리하겠습니다"]);
  });
  it("문턱을 1로 낮추면 한 번 나온 것도 남지만 없는 어구는 여전히 빠진다", () => {
    expect(keepRecurringPhrases(base, samples, 1).phrases).toEqual(["다음 시간에 마무리하겠습니다", "학습 설명회가 있었습니다", "풀어오기"]);
  });
});

describe("profileMentionsAny — 이름 유출 검사", () => {
  const mk = (phrases: string[], closing = "다음 시간에 뵙겠습니다") => parseMentStyleProfile({ tone: "합니다체", sentence: "짧게", phrases, closing })!;
  it("전체 이름은 그대로, 성 뺀 이름은 조사 붙은 꼴('서연이가')까지 잡는다(2자 이상만)", () => {
    expect(profileMentionsAny(mk(["김민준 잘했어요"]), ["김민준", "이", "박서연"])).toEqual(["김민준"]);
    expect(profileMentionsAny(mk(["서연이가 열심히 했어요"]), ["박서연", "최지우"])).toEqual(["박서연"]);
    expect(profileMentionsAny(mk([], "지우야 수고했어"), ["최지우"])).toEqual(["최지우"]);
  });
  it("이름이 다른 낱말 속에 묻혀 있으면(앞이 한글) 잡지 않는다 — 두 글자 성 이름도 성을 뗀다", () => {
    expect(profileMentionsAny(mk(["교서연습을 마무리"]), ["박서연"])).toEqual([]);
    expect(profileMentionsAny(mk(["지우가 열심히"]), ["남궁지우"])).toEqual(["남궁지우"]);
  });
  it("조사·호칭 목록은 발송 게이트(name-mention)와 같다 — '서연만'·'서연처럼'·'서연학생'도 잡는다(재리뷰가 뚫은 것)", () => {
    expect(profileMentionsAny(mk(["서연만 조금 더 챙기면"]), ["박서연"])).toEqual(["박서연"]);
    expect(profileMentionsAny(mk([], "서연처럼 성실한 아이"), ["박서연"])).toEqual(["박서연"]);
    expect(profileMentionsAny(mk(["서연학생은 열심히"]), ["박서연"])).toEqual(["박서연"]);
  });
  it("동명이인 접미(김민준A)는 접미를 뗀 전체 이름으로 본다", () => {
    expect(profileMentionsAny(mk(["김민준입니다"]), ["김민준A"])).toEqual(["김민준A"]);
    expect(profileMentionsAny(mk(["민준이는 꾸준히"]), ["김민준B"])).toEqual(["김민준B"]);
  });
  it("없으면 빈 배열", () => {
    expect(profileMentionsAny(mk(["풀어오기"]), ["박서연", "최지우"])).toEqual([]);
  });
});

describe("mentStyleDirective — 프롬프트 지침 렌더", () => {
  it("머리·어조·문장은 항상, 빈 칸은 줄을 만들지 않고, 마지막 줄이 우선순위·사실·맞춤법 규칙", () => {
    const d = mentStyleDirective({ tone: "합니다체", sentence: "짧게 끊는다", length: "", phrases: [], closing: "", caution: "" });
    const lines = d.split("\n");
    expect(lines[0]).toBe(MENT_STYLE_DIRECTIVE_HEAD);
    expect(lines).toHaveLength(4);
    // 항목 지침(인사말 금지·문장 수)이 말투보다 위, '결'이 첫 문장을 정하고, 사실은 그대로, 맞춤법은 표준
    expect(lines[3]).toContain("이 항목의 지침");
    expect(lines[3]).toContain("'이번 알림장의 결'");
    expect(lines[3]).toContain("맞춤법");
  });
  it("표현은 따옴표로 나열 · 길이는 지침에 안 싣는다(문장 수는 항목 지침이 정한다)", () => {
    const d = mentStyleDirective({ tone: "a", sentence: "b", length: "길다(6~7문장)", phrases: ["다음 시간에", "풀어오기"], closing: "과제 안내", caution: "칭찬 남발" });
    expect(d).toContain('- 자주 쓰는 표현: "다음 시간에", "풀어오기"');
    expect(d).toContain("- 쓰지 않는 표현: 칭찬 남발");
    expect(d).not.toContain("- 길이:");
    expect(d).not.toContain("6~7문장");
  });
});

describe("buildMentStylePrompt — 표본 번호·출처 표시·내용 금지", () => {
  it("표본을 번호 매겨 싣고 [수정] 표시와 개수를 적는다", () => {
    const samples = pickStyleSamples([row("a", "직접 쓴 멘트입니다.\n둘째 줄"), row("b", "고친 멘트입니다.", "auto_edited")]);
    const prompt = buildMentStylePrompt(samples);
    expect(prompt).toContain("[표본 2개 — 직접 작성 1, 자동작성 후 수정 1]");
    // 줄바꿈은 ⏎ 기호 — ' / '로 이으면 모델이 슬래시를 선생님 말투로 읽는다(드라이런 실측)
    expect(prompt).toContain("1. 직접 쓴 멘트입니다. ⏎ 둘째 줄");
    expect(prompt).toContain("선생님이 쓴 기호가 아닙니다");
    expect(prompt).toContain("2. [수정] 고친 멘트입니다.");
    expect(prompt).toContain("내용은 절대 옮기지 마세요");
    expect(prompt).toContain("맞춤법이 틀린 어구는 표현에 넣지 마세요");
    // 끝인사는 알림장 규칙이 금지한다 — 프로파일이 "감사합니다로 마무리"를 배우면 그 규칙과 프롬프트 안에서 부딪힌다(재리뷰)
    expect(prompt).toContain("closing·phrases에 인사말을 적지 마세요");
    expect(prompt).toContain('"phrases"');
  });
});

describe("isMentStyleTableMissingError", () => {
  it("42P01·PGRST205, 또는 표 이름 + 부재 문구가 함께 있을 때만(권한 오류 문구는 미적용이 아니다)", () => {
    expect(isMentStyleTableMissingError({ code: "42P01" })).toBe(true);
    expect(isMentStyleTableMissingError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMentStyleTableMissingError({ message: "relation public.teacher_ment_styles does not exist" })).toBe(true);
    expect(isMentStyleTableMissingError({ message: "Could not find the table 'public.teacher_ment_styles' in the schema cache" })).toBe(true);
    expect(isMentStyleTableMissingError({ code: "42501", message: "permission denied for table teacher_ment_styles" })).toBe(false);
    expect(isMentStyleTableMissingError({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMentStyleTableMissingError(null)).toBe(false);
  });
});
