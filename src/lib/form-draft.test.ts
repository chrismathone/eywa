import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  hasMeaningfulValues,
  loadDraft,
  pickNewerDraft,
  saveDraftOnHide,
  type FormDraft,
} from "./form-draft";

/**
 * 초안 저장/판정의 회귀 그물 — 특히:
 * ① `subjectDetails`(hidden JSON) 통째 제외로 "과목 탭만 입력한 신규 등록상담"이 초안 저장 자체가
 *    안 되던 실버그(2026-08-18)가 다시 생기지 않게 — 내용 딥스캔으로 판정해야 한다.
 * ② 언로드 순간 동기 백스톱(localStorage) — happy-dom엔 indexedDB가 없어 IDB 경로는 자연히 무력화되고,
 *    백스톱만으로 저장→로드→클리어가 돌아야 한다(실브라우저에서 IDB가 죽었을 때와 같은 조건).
 */
describe("hasMeaningfulValues — subjectDetails 딥스캔", () => {
  it("빈 JSON({}·빈 필드)은 의미 없음 — 배너 오탐 방지", () => {
    expect(hasMeaningfulValues({ subjectDetails: "{}" })).toBe(false);
    expect(hasMeaningfulValues({ subjectDetails: '{"math":{"note":""}}' })).toBe(false);
    expect(hasMeaningfulValues({ subjectDetails: '{"math":{}}' })).toBe(false);
  });

  it("🔴 과목 탭에만 내용을 치면 의미 있음 — 통째 제외(구현)로 되돌리면 실패해야 한다", () => {
    expect(hasMeaningfulValues({ name: "", subjectDetails: '{"math":{"note":"진도 상담"}}' })).toBe(
      true,
    );
  });

  it("깨진 JSON은 의미 없음(예외 없이 false)", () => {
    expect(hasMeaningfulValues({ subjectDetails: "{broken" })).toBe(false);
  });

  it("일반 필드 판정은 그대로 — 빈 문자열·id·ignore 제외", () => {
    expect(hasMeaningfulValues({ id: "x", name: "" })).toBe(false);
    expect(hasMeaningfulValues({ name: "김지호" })).toBe(true);
    expect(hasMeaningfulValues({ date: "2026-08-18" }, ["date"])).toBe(false);
  });
});

describe("pickNewerDraft", () => {
  const d = (savedAt: number): FormDraft => ({ scope: "s", savedAt, values: { a: "x" } });

  it("한쪽만 있으면 그쪽, 최신이 이긴다, 동시각이면 IDB 우선", () => {
    expect(pickNewerDraft(null, null)).toBeNull();
    expect(pickNewerDraft(d(1), null)?.savedAt).toBe(1);
    expect(pickNewerDraft(null, d(2))?.savedAt).toBe(2);
    expect(pickNewerDraft(d(1), d(2))?.savedAt).toBe(2);
    expect(pickNewerDraft(d(2), d(1))?.savedAt).toBe(2);
    const fromDb = d(5);
    expect(pickNewerDraft(fromDb, d(5))).toBe(fromDb);
  });
});

describe("saveDraftOnHide 백스톱 — IDB 없이도 저장→로드→클리어", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("pagehide 플러시가 남긴 초안을 loadDraft가 돌려준다", async () => {
    saveDraftOnHide("meeting:new", { title: "주간 회의", notepad: "안건 메모" });
    const loaded = await loadDraft("meeting:new");
    expect(loaded?.values).toEqual({ title: "주간 회의", notepad: "안건 메모" });
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("clearDraft가 백스톱까지 지운다(서버 저장 후 부활 방지)", async () => {
    saveDraftOnHide("meeting:new", { title: "주간 회의" });
    await clearDraft("meeting:new");
    expect(await loadDraft("meeting:new")).toBeNull();
  });

  it("스코프가 다르면 서로 안 섞인다", async () => {
    saveDraftOnHide("a", { x: "1" });
    expect(await loadDraft("b")).toBeNull();
  });
});
