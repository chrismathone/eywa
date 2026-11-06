import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 기능별 키 그룹 — 원장 2026-09-15 *"기능별로 키를 발급받아서 사용량 체크를 하려고"*(9그룹 — 2026-10-20 video 추가).
 * ① 키 해석 규칙(그룹 키 → 옛 버킷 → 기본 키) ② 호출부 이름이 클라이언트까지 가는 배선 ③ 가드.
 */
const { anthropicCreate, clientCalls } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  // 클라이언트를 어떤 버킷·그룹으로 만들었는지 — 배선 검증용
  clientCalls: [] as unknown[][],
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
vi.mock("./anthropic", () => ({
  getAnthropic: (...args: unknown[]) => {
    clientCalls.push(["anthropic", ...args]);
    return { messages: { create: anthropicCreate } };
  },
}));
vi.mock("./deepseek", () => ({
  getDeepseek: (...args: unknown[]) => {
    clientCalls.push(["deepseek", ...args]);
    return { chat: { completions: { create: vi.fn() } } };
  },
}));
import { generateJSON } from "./generate";
import { FEATURE_KEY_GROUP, keyGroupOf, keyLabelOf, resolveKeyEnv, resolveModelChain } from "./models";

// 🔴 SUPABASE 두 개도 비운다 — 있으면 generateJSON이 사용량을 실제 DB(ai_usage_logs)에 쓰려 한다.
const KEYS = [
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY_MENT",
  "ANTHROPIC_API_KEY_CONSULTATIONS",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_KEY_MEETING",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
];
let saved: Record<string, string | undefined>;
// 🔴 이름 차단목록이 아니라 **전수 스윕** — 그룹 키가 실제로 쓰이기 시작하면(셸에 export된 상태로 돌리면)
// 이름을 하나씩 적는 방식은 빠뜨린 키 때문에 헛실패한다(적대적 리뷰 2026-09-15).
let extra: string[] = [];
beforeEach(() => {
  extra = Object.keys(process.env).filter((k) => /_API_KEY(_|$)/.test(k) && !KEYS.includes(k));
  saved = Object.fromEntries([...KEYS, ...extra].map((k) => [k, process.env[k]]));
  KEYS.forEach((k) => delete process.env[k]);
  extra.forEach((k) => delete process.env[k]);
  clientCalls.length = 0;
  anthropicCreate.mockReset();
});
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  extra.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
});

// 아래 가드(파일 스캔)는 describe 수집 때 한 번만 돈다 — 두 describe가 같은 결과를 나눠 쓴다.
let callSitesCache: ReturnType<typeof aiCallSites> | null = null;
const callSites = () => (callSitesCache ??= aiCallSites());

describe("keyGroupOf — 호출부 이름 → 키 그룹", () => {
  it("표에 있는 이름은 그룹으로", () => {
    expect(keyGroupOf("classnote_ment")).toBe("ment");
    expect(keyGroupOf("meeting_analysis")).toBe("meeting");
    expect(keyGroupOf("student_care")).toBe("consultations");
    expect(keyGroupOf("staff_contract_pdf_ocr")).toBe("staff");
  });
  it("모르는 이름 · 빈 값 · 원형 속성 이름은 null", () => {
    expect(keyGroupOf("something_new")).toBeNull();
    expect(keyGroupOf(undefined)).toBeNull();
    expect(keyGroupOf("constructor")).toBeNull();
  });
});

describe("resolveKeyEnv — 그룹 키 → 옛 버킷 → 기본 키", () => {
  it("그룹 키가 있으면 그것을 쓴다", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.ANTHROPIC_API_KEY_MENT = "m";
    expect(resolveKeyEnv("anthropic", "default", "ment")).toBe("ANTHROPIC_API_KEY_MENT");
  });
  it("그룹 키가 없으면 기본 키로 넘어간다 — 키를 하나씩 넣는 동안 멈추는 기능이 없게", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.DEEPSEEK_API_KEY = "d";
    expect(resolveKeyEnv("anthropic", "default", "ment")).toBe("ANTHROPIC_API_KEY");
    expect(resolveKeyEnv("deepseek", "default", "meeting")).toBe("DEEPSEEK_API_KEY");
  });
  it("🔴 Anthropic 상담 키가 없어도 기본 키로 넘어간다(2026-09-15 규칙 변경 — 예전엔 Claude를 건너뛰었다)", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveKeyEnv("anthropic", "consultations", "consultations")).toBe("ANTHROPIC_API_KEY");
    expect(resolveKeyEnv("anthropic", "consultations", null)).toBe("ANTHROPIC_API_KEY");
  });
  it("그룹이 없는 호출은 옛 버킷(consultations) 키를 쓴다", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.ANTHROPIC_API_KEY_CONSULTATIONS = "c";
    expect(resolveKeyEnv("anthropic", "consultations", null)).toBe("ANTHROPIC_API_KEY_CONSULTATIONS");
  });
  it("키가 하나도 없으면 null", () => {
    expect(resolveKeyEnv("deepseek", "default", "ment")).toBeNull();
  });
});

describe("resolveModelChain — 그룹 키만 있어도 그 회사는 후보가 된다", () => {
  it("기본 키 없이 그룹 키만 있는 회사도 체인에 선다", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY_MENT = "m";
    expect(resolveModelChain("fast", "default", undefined, "ment").map((c) => c.provider)).toEqual(["anthropic"]);
    // 그룹을 모르는 호출은 그 키를 못 쓴다(기본 키가 없으니 후보 없음)
    expect(resolveModelChain("fast", "default")).toEqual([]);
  });
});

describe("keyLabelOf — 사용량 표에 남는 이름", () => {
  it("env 이름 → 짧은 이름", () => {
    expect(keyLabelOf("anthropic", "ANTHROPIC_API_KEY_MENT")).toBe("ment");
    expect(keyLabelOf("anthropic", "ANTHROPIC_API_KEY")).toBe("default");
    expect(keyLabelOf("deepseek", "DEEPSEEK_API_KEY_CONSULTATIONS")).toBe("consultations");
    expect(keyLabelOf("deepseek", null)).toBe("none");
  });
});

describe("generateJSON 배선 — 호출부 이름이 키 그룹으로 클라이언트까지 간다", () => {
  const ok = (json: string) => ({ content: [{ type: "text", text: json }], usage: { input_tokens: 1, output_tokens: 1 } });

  it("멘트 호출은 ment 그룹으로 Anthropic 클라이언트를 만든다", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY_MENT = "m";
    anthropicCreate.mockResolvedValueOnce(ok('{"ok":true}'));
    const { data } = await generateJSON<{ ok: boolean }>({
      prompt: "JSON",
      maxTokens: 50,
      tier: "fast",
      meta: { tenantId: "tenant-test", feature: "classnote_ment" },
    });
    expect(data).toEqual({ ok: true });
    expect(clientCalls).toEqual([["anthropic", "default", "ment"]]);
  });

  it("표에 없는 호출은 그룹 없이(null) 만든다", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "a";
    anthropicCreate.mockResolvedValueOnce(ok('{"ok":1}'));
    await generateJSON({ prompt: "JSON", maxTokens: 50, meta: { tenantId: "tenant-test", feature: "something_new" } });
    expect(clientCalls).toEqual([["anthropic", "default", null]]);
  });
});

describe("🔴 오늘 프로덕션 키 조합에서 라우팅이 그대로다(그룹 키 0개)", () => {
  // Vercel Production에 있던 AI 키는 넷이었다(2026-09-15 실측): ANTHROPIC_API_KEY ·
  // ANTHROPIC_API_KEY_CONSULTATIONS · DEEPSEEK_API_KEY · UPSTAGE_API_KEY(2026-10-19 Solar를 빼서 이제 안 쓴다).
  // 이 상태에서 **모든 호출부가 예전과 같은 env를 골라야** 배포 순간 AI 라우팅이 안 바뀐다.
  beforeEach(() => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.ANTHROPIC_API_KEY_CONSULTATIONS = "ac";
    process.env.DEEPSEEK_API_KEY = "d";
  });

  // 🔴 호출부 목록을 **코드에서 읽는다**(feature·keyName 둘 다) — 손으로 적은 복사본은 나중에 호출부가
  // 바뀌어도 초록인 채 이미 일어나지 않는 라우팅을 계속 보증한다(적대적 리뷰 2026-09-15).
  const CASES = callSites().sites;

  /** 옛 규칙을 **그대로 다시 구현**한 것 — 새 코드가 이것과 같은 답을 내야 한다(비교 대상이 있어야 회귀 테스트다). */
  const oldEnv = (base: string, keyName: "default" | "consultations") =>
    keyName === "default" ? base : `${base}_${keyName.toUpperCase()}`;

  it("호출부를 코드에서 읽었다 — 전용 버킷을 쓰는 곳은 상담 계열 넷뿐(분석·케어 + 흐름 분석 둘, 2026-11-03)", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(16);
    expect([...new Set(CASES.filter((s) => s.keyName === "consultations").map((s) => s.feature))].sort()).toEqual([
      "consultation_analysis",
      "student_care",
      "student_flow_consultations",
      "student_flow_timeline",
    ]);
  });

  it("Anthropic 키는 상담 둘만 전용 키, 나머지는 기본 키(예전과 동일)", () => {
    for (const { feature, keyName } of CASES) {
      expect(resolveKeyEnv("anthropic", keyName, keyGroupOf(feature)), feature).toBe(oldEnv("ANTHROPIC_API_KEY", keyName));
    }
  });

  it("DeepSeek은 전용 키가 없으니 전부 기본 키(예전 폴백과 동일)", () => {
    for (const { feature, keyName } of CASES) {
      expect(resolveKeyEnv("deepseek", keyName, keyGroupOf(feature)), feature).toBe("DEEPSEEK_API_KEY");
    }
  });

  it("체인(회사 순서) — anthropic → deepseek 둘뿐(2026-10-19 Solar 제거 · Solar 키가 남아 있어도 안 선다)", () => {
    process.env.UPSTAGE_API_KEY = "u";
    for (const { feature, keyName } of CASES) {
      expect(resolveModelChain("balanced", keyName, undefined, keyGroupOf(feature)).map((c) => c.provider), feature).toEqual([
        "anthropic",
        "deepseek",
      ]);
    }
    delete process.env.UPSTAGE_API_KEY;
  });

  it("그룹 키를 넣으면 그 기능만 새 키로 옮겨간다(나머지는 그대로)", () => {
    process.env.ANTHROPIC_API_KEY_MENT = "m";
    expect(resolveKeyEnv("anthropic", "default", keyGroupOf("classnote_ment"))).toBe("ANTHROPIC_API_KEY_MENT");
    expect(resolveKeyEnv("anthropic", "default", keyGroupOf("daily_briefing"))).toBe("ANTHROPIC_API_KEY");
    expect(resolveKeyEnv("anthropic", "consultations", keyGroupOf("student_care"))).toBe("ANTHROPIC_API_KEY_CONSULTATIONS");
  });
});

// ── 가드 ─────────────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * `keyName`을 **변수로** 넘기는 호출부 — 리터럴이 아니라 코드에서 값을 읽을 수 없으니 **사람이 여기 적는다**.
 * ⚠️ 이 표는 그 선언 기본값을 **읽지 않는다** — `form-extract.ts`의 기본값을 바꾸거나 호출부가 다른 값을
 * 넘기면 여기 적힌 값이 사실과 어긋난 채 초록이다(적대적 리뷰 2026-09-15). 새 항목을 더할 땐 선언을 직접 볼 것.
 * 표에 없는 변수 호출부는 `missing`으로 빨개지므로 **조용히 늘지는 않는다**.
 */
const KEYNAME_BY_VARIABLE: Readonly<Record<string, "default" | "consultations">> = {
  // form-extract.ts: `keyName: AiKeyName = "default"` 파라미터를 그대로 넘긴다(호출부는 전부 기본값).
  enrollment_form_extract: "default",
};

type CallSite = { feature: string; keyName: "default" | "consultations"; file: string };

/** 객체 리터럴에서 이름이 같은 속성 — 없으면 undefined. */
function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText().replace(/['"]/g, "") === name) return p.initializer;
  }
  return undefined;
}
const literal = (e?: ts.Expression) => (e && ts.isStringLiteralLike(e) ? e.text : undefined);
/** 속성이 **있는가**만 — `{ tenantId }` 줄임 표기까지 센다(값이 무엇인지는 보지 않는다). */
function hasProp(obj: ts.ObjectLiteralExpression, name: string): boolean {
  return obj.properties.some(
    (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText().replace(/['"]/g, "") === name,
  );
}

/**
 * src 전체의 `generateJSON` 호출부 — feature와 keyName을 **코드에서** 읽는다(손으로 적은 복사본 금지).
 *
 * 🔴 **TypeScript 파서로 본다.** 한 줄 정규식(`/feature:\s*"…"/`)으로 훑던 옛 스캐너는 `meta`를 아예 안 넘긴
 * 새 호출부를 못 잡았고(적대적 리뷰 2026-09-15: `meta` 없음 · 홑따옴표 · camelCase · 상수 참조 넷이 초록으로 샜다),
 * 손으로 만든 괄호 세기는 주석·정규식·따옴표에 계속 걸린다. `meta`는 타입에서도 optional이라 컴파일러도 안 막는다 —
 * 안 넘긴 호출은 조용히 기본 키로 불리고 `ai_usage_logs.feature`에 `"unknown"`으로 쌓인다.
 */
function aiCallSites(): { sites: CallSite[]; missing: string[]; noTenant: string[] } {
  const sites: CallSite[] = [];
  const missing: string[] = [];
  // `meta.tenantId`를 안 넘긴 호출부 — `ai_usage_logs.tenant_id`가 null로 쌓여 지점이 둘 이상이면 어느 지점 비용인지 못 가른다.
  const noTenant: string[] = [];
  for (const file of walk(join(process.cwd(), "src"))) {
    if (file.includes(join("src", "lib", "ai"))) continue; // 진입점 자신
    const src = readFileSync(file, "utf8");
    if (!src.includes("generateJSON")) continue;
    const rel = file.slice(file.indexOf(`src${sep}`));
    const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node: ts.Node): void => {
      // endsWith — 별칭(`gen(...)`은 못 잡지만)·네임스페이스 호출(`ai.generateJSON(...)`)까지 본다.
      if (ts.isCallExpression(node) && node.expression.getText(source).endsWith("generateJSON")) {
        const arg = node.arguments[0];
        const at = `${rel}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          missing.push(`${at} (인자가 객체 리터럴이 아니다)`);
        } else {
          const meta = prop(arg, "meta");
          const feature = meta && ts.isObjectLiteralExpression(meta) ? literal(prop(meta, "feature")) : undefined;
          if (meta && ts.isObjectLiteralExpression(meta) && !hasProp(meta, "tenantId")) noTenant.push(at);
          if (!feature) missing.push(`${at} (meta.feature 없음)`);
          else {
            // keyName을 아예 안 넘기면 generateJSON의 선언 기본값 "default" · 리터럴이면 그 값 ·
            // 변수로 넘기면 KEYNAME_BY_VARIABLE에 적힌 값(안 적혀 있으면 빨갛게).
            const raw = prop(arg, "keyName");
            const k = !raw ? "default" : (literal(raw) ?? KEYNAME_BY_VARIABLE[feature]);
            if (k !== "default" && k !== "consultations") {
              missing.push(`${at} (keyName을 읽을 수 없다 — KEYNAME_BY_VARIABLE에 적을 것)`);
            } else sites.push({ feature, keyName: k, file: rel });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { sites, missing, noTenant };
}

describe("가드 — 모든 AI 호출부는 키 그룹이 있다", () => {
  const features = new Set(callSites().sites.map((s) => s.feature));

  it("AI 호출부를 실제로 찾았다(빈 집합으로 통과하지 않게)", () => {
    expect(features.size).toBeGreaterThanOrEqual(15);
  });
  it("🔴 모든 generateJSON 호출이 meta.feature를 넘긴다(안 넘기면 기본 키 + feature='unknown')", () => {
    expect(callSites().missing).toEqual([]);
  });
  it("🔴 모든 generateJSON 호출이 meta.tenantId를 넘긴다(안 넘기면 사용량이 지점 없이 쌓인다 — 원장 2026-09-21 'AI도 지점 분리')", () => {
    // 실측 2026-09-21: ai_usage_logs 3,499행 중 2,794행이 지점 빈칸이었다(호출부 8곳이 안 넘겼다).
    // 세션이 없는 경로(웹훅·크론·after)는 행의 tenant_id를, 서버 액션은 user.tenantId를 넘긴다.
    expect(callSites().noTenant).toEqual([]);
  });
  it("🔴 새 AI 기능이 그룹 표에 빠지면 여기서 빨개진다(빠지면 기본 키로 불려 사용량이 안 갈린다)", () => {
    expect([...features].filter((f) => !(f in FEATURE_KEY_GROUP))).toEqual([]);
  });
  it("표에만 있고 코드엔 없는 이름이 없다(오타 · 걷어낸 기능)", () => {
    expect(Object.keys(FEATURE_KEY_GROUP).filter((f) => !features.has(f))).toEqual([]);
  });
});

describe("가드 — CLAUDE.md의 9그룹 표가 코드와 같다", () => {
  // 이 리포의 다른 배선 가드와 같은 결 — 문서만 조용히 뒤처지는 것을 막는다(적대적 리뷰 2026-09-15).
  // 🔴 **그 절만** 본다 — 문서 전체에서 찾으면 다른 절에 한 번 더 나오는 이름(`classnote_ment`는 fast 티어
  // 표에도 있다)이 9그룹 표에서 빠져도 초록이 된다.
  const whole = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf8");
  const from = whole.indexOf("### 키 분리 = 기능별 9그룹");
  const doc = from < 0 ? "" : whole.slice(from, whole.indexOf("\n## ", from) + 1 || undefined);

  it("그 절을 찾았다(제목이 바뀌면 빈 문자열로 통과하지 않게)", () => {
    expect(from).toBeGreaterThan(0);
    expect(doc.length).toBeGreaterThan(500);
  });

  it("그룹 9개가 전부 문서에 있다", () => {
    // 표가 그룹 이름을 홑따옴표 코드로 적는다(`MENT`) — 그대로 찾는다. 맨 대문자로 찾으면
    // `MENT`가 `ENROLLMENT` 안에 들어 있어 빠진 그룹도 통과한다.
    const groups = [...new Set(Object.values(FEATURE_KEY_GROUP))];
    expect(groups.filter((g) => !doc.includes(`\`${g.toUpperCase()}\``))).toEqual([]);
  });
  it("호출부 이름 20개가 전부 문서에 있다", () => {
    expect(Object.keys(FEATURE_KEY_GROUP).filter((f) => !doc.includes(f))).toEqual([]);
  });
});
