/**
 * **과목 라벨은 부가 정보다 — 본체(브리핑)를 죽이면 안 된다.**
 *
 * 2026-08-29 리뷰에서 잡힌 것: 과목 분해가 쓰는 `getAbsenceRiskAnchor`가 `throw`하는데 브리핑의
 * `Promise.all` 안에 그대로 들어가 있었다. `Promise.all`은 하나만 깨져도 reject하므로, 그 조회 한 번이
 * 실패하면 **그날 브리핑이 통째로 안 만들어진다** — 라벨 하나 때문에.
 * 같은 배치의 `getAbsenceRiskStudents`는 명단 그 자체라 throw가 맞지만, 앵커는 그 급이 아니다.
 *
 * 그리고 화면에 붙는 숫자는 **RPC 총계와 합이 같을 때만** 내보낸다(groundedSubjects) — 나란히 놓인
 * "8회"와 "수학 6 · 영어 1" 중 뭐가 거짓인지 화면만 봐선 알 수 없기 때문이다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const briefing = strip(read("src", "features", "dashboard", "server", "briefing.ts"));
const digest = strip(read("src", "features", "dashboard", "briefing-digest.ts"));

describe("부가 조회가 브리핑을 죽이지 않는다", () => {
  it("앵커 조회는 fail-soft다(Promise.all 안에서 throw 금지)", () => {
    expect(briefing).toMatch(/getAbsenceRiskAnchor\(db\)\.catch\(/);
  });

  it("분해 조회도 fail-soft다", () => {
    expect(briefing).toMatch(/getAbsenceBreakdown\([\s\S]{0,200}\)\.catch\(/);
  });

  it("실패를 조용히 삼키지 않고 알린다", () => {
    expect(briefing).toContain("briefing.absenceAnchor");
    expect(briefing).toContain("briefing.absenceSubjects");
  });
});

describe("과목 수치는 총계와 합이 같을 때만 내보낸다", () => {
  it("groundedSubjects가 합을 검산한다", () => {
    expect(digest).toMatch(/sum === risk\.absences \? buckets : \[\]/);
  });

  it("라벨 리졸버가 없으면 분해를 생략한다(raw 과목 키 노출 금지)", () => {
    // labelSubjectCounts가 리졸버 없으면 []를 돌려준다 — 화면에 `english`가 그대로 나가지 않게.
    const todayActions = strip(read("src", "features", "dashboard", "today-actions.ts"));
    expect(todayActions).toMatch(/if \(!subjectLabel \|\| rows\.length === 0\) return \[\]/);
  });
});

describe("🔴 결석 사유 원문은 AI 프롬프트로 나가지 않는다", () => {
  // 사유는 자유 텍스트라 무엇이 적힐지 통제할 수 없고, 실제로 `병결(입원)`·`병원 진료` 같은 건강 정보가
  // 들어 있다. 매니저 보고가 판단할 재료는 "양해된 결석인가"(사전 통보 건수)이지 "왜"가 아니다.
  const prompt = strip(read("src", "features", "dashboard", "briefing-team-report.ts"));

  it("프롬프트 조립부가 reasonText를 읽지 않는다", () => {
    expect(prompt).not.toContain("reasonText");
  });

  it("payload의 reasons엔 숫자만 담는다(사유 원문은 reasonText로 갈라 둔다)", () => {
    expect(digest).toMatch(/absenceReasonTail\(risk\.reasonSummary, \{ forPrompt: true \}\)/);
    expect(digest).toMatch(/reasonText: risk\.reasonSummary\.reasons\.join/);
  });

  it("forPrompt면 사유를 빼는 규칙이 단일 소스에 있다", () => {
    const mod = strip(read("src", "features", "dashboard", "absence-reasons.ts"));
    expect(mod).toMatch(/!opts\.forPrompt && summary\.reasons\.length > 0/);
  });
});

describe("사전 통보는 총계를 깎지 않는다", () => {
  it("표시되는 N회는 여전히 안 깎는다 — 빼기는 **목록 편입 판정**에서만", () => {
    // 원장 2026-08-29 후속 *"사전통보는 살펴볼 학생 리스트에서 배제시켜"* — 목록에서만 빼고
    // 숫자는 그대로 둔다(RPC 0221a 값·결석 마일스톤 알림과 갈리지 않게).
    expect(digest).toMatch(/최근 14일 결석 \$\{risk\.absences\}회/);
    expect(digest).toMatch(/unexplainedAbsences\(risk\.absences, risk\.reasonSummary\) === 0\) continue/);
    // 판정은 단일 소스에만 있다 — 화면·보고가 따로 계산하면 목록과 숫자가 갈린다.
    expect(digest).not.toMatch(/risk\.absences\s*-\s*[^;]*preNotified/);
  });

  it("세는 단위가 과목 분해와 같다(공용 effectiveAbsences)", () => {
    const mod = strip(read("src", "features", "dashboard", "absence-reasons.ts"));
    expect(mod).toContain("effectiveAbsences");
  });
});

describe("옛 payload 하위 호환", () => {
  it("bySubject가 없던 저장분을 읽어도 깨지지 않는다", () => {
    // 스포트라이트 payload는 스냅샷이라 2026-08-29 이전 행엔 이 키가 아예 없다.
    for (const src of [
      strip(read("src", "features", "dashboard", "briefing-team-report.ts")),
    ]) {
      expect(src).toMatch(/bySubject \?\? \[\]/);
    }
    expect(digest).toMatch(/spotlight\.bySubject \?\? \[\]/);
  });
});
