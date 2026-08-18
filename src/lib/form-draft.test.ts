import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  readFormValues,
  applyFormValues,
  hasMeaningfulValues,
  clearDraft,
  loadDraft,
  pickNewerDraft,
  saveDraftOnHide,
  type FormDraft,
} from "./form-draft";

function makeForm(html: string): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = html;
  document.body.appendChild(form);
  return form;
}
afterEach(() => {
  document.body.innerHTML = "";
});

describe("form-draft helpers", () => {
  it("readFormValues — name 가진 input/select/checkbox 캡처, file/submit 제외", () => {
    const form = makeForm(`
      <input name="prospectName" value="김민준" />
      <select name="prospectGrade">
        <option value="중1">중1</option>
        <option value="중3" selected>중3</option>
      </select>
      <input type="checkbox" name="shuttleBusRequest" value="true" checked />
      <input type="checkbox" name="privacyAgreement" value="true" />
      <textarea name="parentRequest">첫 줄
둘째 줄</textarea>
      <input type="file" name="audio" />
      <button type="submit" name="go">저장</button>
    `);
    const v = readFormValues(form);
    expect(v.prospectName).toBe("김민준");
    expect(v.prospectGrade).toBe("중3");
    expect(v.shuttleBusRequest).toBe("true");
    expect(v.privacyAgreement).toBe(""); // 미체크
    expect(v.parentRequest).toContain("둘째 줄"); // 줄바꿈 보존
    expect("audio" in v).toBe(false); // file 제외
    expect("go" in v).toBe(false); // submit 제외
  });

  it("applyFormValues — 빈 폼에 값 복원", () => {
    const form = makeForm(`
      <input name="prospectName" />
      <select name="prospectGrade"><option value="중1">중1</option><option value="중3">중3</option></select>
      <input type="checkbox" name="shuttleBusRequest" value="true" />
    `);
    applyFormValues(form, { prospectName: "박지율", prospectGrade: "중3", shuttleBusRequest: "true" });
    expect((form.elements.namedItem("prospectName") as HTMLInputElement).value).toBe("박지율");
    expect((form.elements.namedItem("prospectGrade") as HTMLSelectElement).value).toBe("중3");
    expect((form.elements.namedItem("shuttleBusRequest") as HTMLInputElement).checked).toBe(true);
  });

  it("hasMeaningfulValues — id/빈값은 무시 + ignore 인자", () => {
    expect(hasMeaningfulValues({})).toBe(false);
    expect(hasMeaningfulValues({ id: "abc", subjectDetails: "{}" })).toBe(false);
    expect(hasMeaningfulValues({ prospectName: "  " })).toBe(false);
    expect(hasMeaningfulValues({ prospectName: "김민준" })).toBe(true);
    // 기본값이 항상 채워지는 필드는 ignore로 빈 폼 오탐 방지
    expect(hasMeaningfulValues({ category: "general", audience: "parent" }, ["category", "audience"])).toBe(false);
    expect(hasMeaningfulValues({ category: "general", summary: "상담함" }, ["category"])).toBe(true);
  });

  it("readFormValues — exclude 필드는 캡처 안 함(비밀번호 등)", () => {
    const form = makeForm(`<input name="summary" value="내용" /><input type="password" name="password" value="secret" />`);
    const v = readFormValues(form, ["password"]);
    expect(v.summary).toBe("내용");
    expect("password" in v).toBe(false);
  });
});

/**
 * 아래는 "타이핑 유실 0" 강화(2026-08-18) 회귀 그물 — 배포 스큐 강제 리로드로 회의록 녹음 화면이
 * 통째로 새로고침된 사고 후속.
 * ① `subjectDetails`(hidden JSON) 통째 제외로 "과목 탭만 입력한 신규 등록상담"이 초안 저장 자체가
 *    안 되던 실버그 — 내용 딥스캔으로 판정해야 한다.
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
