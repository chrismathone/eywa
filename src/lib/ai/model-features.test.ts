import { describe, expect, it } from "vitest";
import { FIXED_MODEL_FEATURES, TENANT_MODEL_FEATURES, modelChoicesFor } from "./model-features";
import { AI_MODEL_CHOICES, FEATURE_MODELS, choicePin, featurePin, modelFeatureOf } from "./model-pins";
import { AI_MODELS, FEATURE_KEY_GROUP, resolveModelChain } from "./models";
import { modelDisplayLabel } from "./model-label";
import { isModelNotFoundError } from "./generate";
import { IN_FLIGHT_MS, isFresh, isInFlight } from "./transcription-inflight";

describe("운영 콘솔 'AI 모델' 줄 = AI 기능 전부(가드)", () => {
  it("FEATURE_KEY_GROUP의 기능은 고르는 줄이나 고정 목록 중 한 곳에 꼭 있다", () => {
    const listed = new Set([...TENANT_MODEL_FEATURES.map((f) => f.key), ...Object.keys(FIXED_MODEL_FEATURES)]);
    const missing = Object.keys(FEATURE_KEY_GROUP).filter((k) => !listed.has(k));
    expect(missing).toEqual([]);
  });
  it("없는 기능을 줄로 세우지 않는다 · 같은 기능이 두 번 서지 않는다", () => {
    const keys = TENANT_MODEL_FEATURES.map((f) => f.key);
    expect(keys.filter((k) => !(k in FEATURE_KEY_GROUP))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k in FIXED_MODEL_FEATURES)).toEqual([]);
  });
  it("계약서 스캔 인식은 고를 수 없다(Claude 전용 승인 범위)", () => {
    expect(keys()).not.toContain("staff_contract_pdf_ocr");
  });
});
const keys = () => TENANT_MODEL_FEATURES.map((f) => f.key);

describe("고를 수 있는 모델", () => {
  it("모두 모델 표에 있는 실제 id다(티어 표 어딘가의 값)", () => {
    const known = new Set(Object.values(AI_MODELS).flatMap((t) => Object.values(t)).filter(Boolean));
    expect(AI_MODEL_CHOICES.filter((c) => !known.has(c.model))).toEqual([]);
  });
  it("선생님이 기다리는 기능(멘트)엔 느린 v4-pro를 고를 수 없다(86초 실측)", () => {
    expect(modelChoicesFor("classnote_ment").map((c) => c.model)).not.toContain("deepseek-v4-pro");
    expect(modelChoicesFor("english_ment").map((c) => c.model)).not.toContain("deepseek-v4-pro");
    expect(modelChoicesFor("meeting_analysis").map((c) => c.model)).toContain("deepseek-v4-pro");
  });
  it("목록 밖의 값은 고정하지 않는다", () => {
    expect(choicePin("gpt-9")).toBeNull();
    expect(choicePin(undefined)).toBeNull();
    expect(choicePin("deepseek-flash")).toEqual({ provider: "deepseek", model: "deepseek-flash" });
  });
});

describe("featurePin — 지점 선택 > 코드 기본 > 없음", () => {
  it("코드 기본(전사 분석 셋 = Sonnet 5.5 · 2026-10-26 원장 '전사 분석은 전부 sonnet 5.5' + 2026-10-20 영상 설명 판정·확인)", () => {
    // 원생 흐름 분석 둘(연결 탐색 2026-11-03 — 상담 기록 분석이라 전사 분석과 같은 Sonnet 5.5)을 병합하며 더했다(2026-11-05).
    expect(Object.keys(FEATURE_MODELS).sort()).toEqual(["enrollment_analysis", "enrollment_form_extract", "meeting_analysis", "student_flow_consultations", "student_flow_timeline", "video_review_judge", "video_review_verify"]);
    expect(featurePin("video_review_judge")).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
    expect(featurePin("video_review_verify")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    for (const f of ["meeting_analysis", "enrollment_analysis", "enrollment_form_extract", "student_flow_consultations", "student_flow_timeline"]) {
      expect(featurePin(f), f).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    }
  });
  it("지점이 고르면 그게 먼저 · 이상한 값은 무시하고 코드 기본", () => {
    expect(featurePin("meeting_analysis", "deepseek-flash")).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    // 5.5로 올리기 전 이름이 남아 있어도 목록 밖 = 코드 기본(2026-10-19)
    expect(featurePin("meeting_analysis", "claude-sonnet-5")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(featurePin("meeting_analysis", "없는모델")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(featurePin("classnote_ment")).toBeNull();
    expect(featurePin("constructor")).toBeNull();
  });
  it("멘트 미리보기는 운영 자동작성의 선택을 따른다", () => {
    expect(modelFeatureOf("ment_prompt_preview")).toBe("classnote_ment");
  });
});

describe("resolveModelChain — 고정 모델", () => {
  const envBackup = { ...process.env };
  const setKeys = (keys: Record<string, string | undefined>) => {
    for (const k of ["ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "AI_PROVIDER"]) delete process.env[k];
    Object.assign(process.env, keys);
  };
  it("고정한 회사가 맨 앞에 그 모델로, 나머지는 평소 사다리", () => {
    setKeys({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d", AI_PROVIDER: "anthropic" });
    const chain = resolveModelChain("balanced", "default", undefined, null, { provider: "deepseek", model: "deepseek-flash" });
    expect(chain.map((c) => `${c.provider}:${c.model}`)).toEqual(["deepseek:deepseek-flash", "anthropic:claude-sonnet-5-5"]);
    process.env = { ...envBackup };
  });
  it("고정한 회사 키가 없으면 평소 사다리 그대로(기능이 멈추지 않는다)", () => {
    setKeys({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "anthropic" });
    const chain = resolveModelChain("balanced", "default", "deepseek", null, { provider: "deepseek", model: "deepseek-flash" });
    expect(chain.map((c) => c.model)).toEqual(["claude-sonnet-5-5"]);
    process.env = { ...envBackup };
  });
  it("reasoning 티어엔 고정을 걸지 않는다", () => {
    setKeys({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" });
    const chain = resolveModelChain("reasoning", "default", undefined, null, { provider: "deepseek", model: "deepseek-flash" });
    expect(chain.map((c) => c.provider)).toEqual(["anthropic"]);
    process.env = { ...envBackup };
  });
  it("fast 티어 딥시크 = 새 이름 deepseek-flash(옛 이름은 은퇴)", () => {
    expect(AI_MODELS.fast.deepseek).toBe("deepseek-flash");
  });
});

describe("isModelNotFoundError — 고정 모델 이름이 없을 때 같은 회사 기본 모델로", () => {
  it("회사별 '모델 없음' 모양", () => {
    expect(isModelNotFoundError({ status: 400, message: "Model Not Exist" })).toBe(true); // DeepSeek
    expect(isModelNotFoundError({ status: 404, message: "not_found_error: model: claude-x" })).toBe(true); // Anthropic
    expect(isModelNotFoundError(new Error('{"code":"model_not_found"}'))).toBe(true);
  });
  it("다른 오류는 아니다", () => {
    expect(isModelNotFoundError({ status: 400, message: "bad request" })).toBe(false);
    expect(isModelNotFoundError({ status: 429, message: "rate limit" })).toBe(false);
    expect(isModelNotFoundError(new Error("JSON parse error"))).toBe(false);
  });
});

describe("모델 라벨", () => {
  it("새 이름 · 옛 이름 둘 다 원시 id 없이", () => {
    expect(modelDisplayLabel("deepseek-flash-2026-10-19")).toBe("DeepSeek V4.1 flash");
    expect(modelDisplayLabel("deepseek-v4-flash")).toBe("DeepSeek v4-flash");
    expect(modelDisplayLabel("deepseek-v4-pro-2026-07-16")).toBe("DeepSeek v4-pro");
    expect(modelDisplayLabel("claude-sonnet-5-5-2026-10-19")).toBe("Claude Sonnet 5.5");
    expect(modelDisplayLabel("claude-sonnet-5-2026-07-16")).toBe("Claude Sonnet 5");
  });
});

describe("전사 웹훅 재전송 걸러 내기", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  it("방금 시작한 분석만 '진행 중'", () => {
    expect(isFresh(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isFresh(new Date(now - IN_FLIGHT_MS - 1).toISOString(), now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
    expect(isFresh("이상한 값", now)).toBe(false);
  });
  it("'analyzing'일 때만", () => {
    expect(isInFlight("transcribing", new Date().toISOString())).toBe(false);
    expect(isInFlight("analyzing", new Date().toISOString())).toBe(true);
  });
});
