import { describe, it, expect, afterEach } from "vitest";
import { readFormValues, applyFormValues, hasMeaningfulValues } from "./form-draft";

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

  it("hasMeaningfulValues — id/subjectDetails/빈값은 무시 + ignore 인자", () => {
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
