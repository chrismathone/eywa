import { describe, expect, it } from "vitest";
import {
  MENT_STYLE_MAX_EDITED,
  MENT_STYLE_MAX_SAMPLES,
  corpusUntil,
  isMentStyleTableMissingError,
  keepRecurringPhrases,
  keepGroundedEdits,
  parseMentStyleProfile,
  pickStyleSamples,
  profileMentionsAny,
  styleCorpusHash,
  type StyleSampleRow,
} from "./ment-style";
import {
  MENT_STYLE_DIRECTIVE_HEAD,
  MENT_STYLE_PROMPT_VERSION,
  MENT_STYLE_TONE_HEAD,
  buildMentStylePrompt,
  dropTemplatePhrases,
  mentStyleDirective,
  mentStyleToneDirective,
} from "./ment-style-prompt";

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

describe("dropTemplatePhrases — 기본 프롬프트의 문구는 선생님 표현이 아니다", () => {
  it("획일성 문구를 품은 어구는 빠지고 선생님 고유 어구는 남는다(공백 차이 무시)", () => {
    const p = parseMentStyleProfile({
      tone: "a",
      sentence: "b",
      phrases: ["오늘은", "오늘과제는", "오늘은 ~을 배웠습니다", "아주 좋았습니다", "풀어오기", "보완해 나가겠습니다"],
    })!;
    expect(dropTemplatePhrases(p).phrases).toEqual(["풀어오기", "보완해 나가겠습니다"]);
  });
  it("기본 프롬프트 예시 문장의 부분 문자열이라는 이유로는 지우지 않는다(리뷰: 전문을 재료로 썼더니 26개 중 23개가 사라졌다)", () => {
    const p = parseMentStyleProfile({
      tone: "a",
      sentence: "b",
      phrases: ["다음시간에", "성실히 참여했습니다", "다 해왔습니다", "제출하지 않았습니다", "마무리했습니다", "확인", "과제"],
    })!;
    expect(dropTemplatePhrases(p).phrases).toEqual(p.phrases);
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

// 2026-10-16 원장 "한계를 수정할 수 있을까" — 학습 추세엔 말투가 안 붙던 것. 어조만 붙인다.
describe("mentStyleToneDirective — 학습 추세용(어조·문장 결만)", () => {
  it("🔴 표현·마무리·쓰지 않는 표현은 싣지 않는다 — 선생님 표현('~하겠습니다')을 따라 쓰면 추세 금지(계획)에 걸려 버려진다", () => {
    const d = mentStyleToneDirective({ tone: "해요체", sentence: "짧게 끊는다", length: "길다", phrases: ["다음 시간에 마무리하겠습니다"], closing: "다음 수업 예고", caution: "칭찬 남발" });
    expect(d.split("\n")[0]).toBe(MENT_STYLE_TONE_HEAD);
    expect(d).toContain("- 어조: 해요체");
    expect(d).toContain("- 문장: 짧게 끊는다");
    expect(d).not.toContain("마무리하겠습니다");
    expect(d).not.toContain("다음 수업 예고");
    expect(d).not.toContain("칭찬 남발");
    expect(d).toContain("[기록]에 없는 말은 덧붙이지 마세요");
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
    expect(prompt).toContain("closing·phrases·edits에 인사말을 적지 마세요");
    expect(prompt).toContain('"phrases"');
  });
  // 2026-10-16 원장 "한계를 수정할 수 있을까" — 무엇을 고쳤는지(0370a 원문)를 함께 보여 '늘 고치는 것'을 받는다.
  it("수정 표본에 고치기 전 자동작성 원문이 있으면 옆에 싣고 'edits'를 받는다", () => {
    const samples = pickStyleSamples([
      row("a", "직접 쓴 멘트입니다."),
      { ...row("b", "도수분포다각형을 배웠습니다. 오늘 과제는 교재 마무리 & 프린트 단원 총괄 풀이입니다.", "auto_edited"), draft: "도수분포다각형을 알아보았습니다. 오늘 과제는 교재 마무리와 프린트입니다." },
    ]);
    const prompt = buildMentStylePrompt(samples);
    expect(prompt).toContain("2. [수정] 도수분포다각형을 배웠습니다.");
    expect(prompt).toContain("   ↳ 고치기 전 자동작성: 도수분포다각형을 알아보았습니다.");
    expect(prompt).toContain("(그중 고치기 전 원문이 있는 것 1)");
    expect(prompt).toContain('"edits"');
    expect(prompt).toContain("사실을 바로잡은 것");
  });
  it("원문은 수정 표본에만 · 최종과 같으면 버린다 · 원문이 붙으면 지문이 바뀐다(다시 접는다)", () => {
    const same = pickStyleSamples([{ ...row("b", "고친 멘트입니다.", "auto_edited"), draft: "고친 멘트입니다." }]);
    expect(same[0]!.draft).toBeNull();
    const manual = pickStyleSamples([{ ...row("a", "직접 쓴 멘트입니다."), draft: "AI 글" }]);
    expect(manual[0]!.draft).toBeNull();
    const without = pickStyleSamples([row("b", "고친 멘트입니다.", "auto_edited")]);
    const withDraft = pickStyleSamples([{ ...row("b", "고친 멘트입니다.", "auto_edited"), draft: "AI가 쓴 멘트입니다." }]);
    expect(styleCorpusHash(without, 5)).not.toBe(styleCorpusHash(withDraft, 5));
  });
});

describe("늘 고치는 것(edits) — 검증·지침·이름 가드", () => {
  const base = { tone: "합니다체", sentence: "짧게", length: "", phrases: [], closing: "", caution: "" };
  it("🔴 인사말·계획·덧붙이는 내용·코드가 붙이는 문장은 버린다 — 끝인사 금지를 다시 뚫거나 없는 말을 지어내지 않게(재리뷰 2026-10-16)", () => {
    const p = parseMentStyleProfile({
      ...base,
      edits: ["끝에 '감사합니다'를 붙인다", "'다음 시간에 오답 확인하겠습니다'를 덧붙인다", "보강 일정을 안내한다", "영상 과제 안내 문장을 지운다", "'아주 좋았습니다'를 지운다"],
    })!;
    expect(p.edits).toEqual(["'아주 좋았습니다'를 지운다"]);
    // 낱말이 아니라 고침의 방향 — 덧붙이는 줄은 늘 버리고, 지우고 바꾸는 줄은 남긴다(재리뷰 2026-10-16)
    const q = parseMentStyleProfile({
      ...base,
      edits: ["끝인사를 넣는다", "마지막에 '고맙습니다'를 붙인다", "마지막에 다음 수업 예고를 붙인다", "끝에 보강 안내를 넣는다", "'~하겠습니다'를 '~합니다'로 바꾼다", "'감사합니다'를 지운다"],
    })!;
    expect(q.edits).toEqual(["'~하겠습니다'를 '~합니다'로 바꾼다", "'감사합니다'를 지운다"]);
  });
  it("고치기 전 원문이 붙은 표본이 3개 미만이면 edits를 비운다 — 원문 없이 받은 edits는 지어낸 것", () => {
    const prof = { ...base, edits: ["'아주 좋았습니다'를 지운다"] };
    const two = pickStyleSamples([1, 2].map((k) => ({ ...row(`e${k}`, `고친 멘트 ${k}번입니다.`, "auto_edited"), draft: `AI 멘트 ${k}번입니다.` })));
    expect(keepGroundedEdits(prof, two).edits).toEqual([]);
    const three = pickStyleSamples([1, 2, 3].map((k) => ({ ...row(`e${k}`, `고친 멘트 ${k}번입니다.`, "auto_edited"), draft: `AI 멘트 ${k}번입니다.` })));
    expect(keepGroundedEdits(prof, three).edits).toEqual(["'아주 좋았습니다'를 지운다"]);
  });
  it("짧은 줄만 최대 5개 · 숫자 든 줄(그날의 내용)·너무 긴 줄은 버린다 · 옛 프로파일(칸 없음)은 빈 배열", () => {
    const p = parseMentStyleProfile({ ...base, edits: ["'아주 좋았습니다'를 지운다", "18문제 중 14개로 고친다", "가".repeat(81), "오늘 과제는 입력 그대로 다 적는다", "a", "b", "c", "d"] })!;
    expect(p.edits).toEqual(["'아주 좋았습니다'를 지운다", "오늘 과제는 입력 그대로 다 적는다", "a", "b", "c"]);
    expect(parseMentStyleProfile(base)!.edits).toEqual([]);
  });
  it("지침에 한 줄로 싣는다 — 비면 줄이 없다", () => {
    expect(mentStyleDirective({ ...base, edits: ["'아주 좋았습니다'를 지운다", "오늘 과제는 입력 그대로 다 적는다"] })).toContain(
      "- 이 선생님이 자동작성 글에서 늘 고치는 것([입력]의 사실 안에서 처음부터 그렇게 쓰세요): '아주 좋았습니다'를 지운다 · 오늘 과제는 입력 그대로 다 적는다",
    );
    expect(mentStyleDirective({ ...base, edits: [] })).not.toContain("늘 고치는 것");
  });
  it("🔴 학생 이름이 '늘 고치는 것'에 새도 잡는다(다른 아이 알림장에 나간다)", () => {
    expect(profileMentionsAny({ ...base, edits: ["서연이 이름을 앞에 붙인다"] }, ["박서연"])).toEqual(["박서연"]);
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
