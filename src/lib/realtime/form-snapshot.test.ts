import { describe, it, expect } from "vitest";
import { serializeForm } from "./form-snapshot";

function makeForm(html: string): HTMLFormElement {
  const f = document.createElement("form");
  f.innerHTML = html;
  return f;
}

describe("serializeForm", () => {
  it("필드 값이 바뀌면 스냅샷이 달라진다(버튼→hidden input 변경 포함)", () => {
    const f = makeForm('<input name="a" value="1"><input type="hidden" name="b" value="x">');
    const before = serializeForm(f);
    // 버튼 클릭으로 state→hidden input 값이 바뀌는 경우(반 시간표 토글·설정 add/remove) 시뮬레이션.
    (f.querySelector('[name="b"]') as HTMLInputElement).value = "y";
    expect(serializeForm(f)).not.toBe(before);
  });

  it("필드 순서가 달라도 같은 값이면 동일 스냅샷(정렬)", () => {
    const f1 = makeForm('<input name="a" value="1"><input name="b" value="2">');
    const f2 = makeForm('<input name="b" value="2"><input name="a" value="1">');
    expect(serializeForm(f1)).toBe(serializeForm(f2));
  });

  it("React Server Actions 내부 필드($ACTION_*)는 제외", () => {
    const f1 = makeForm('<input name="a" value="1">');
    const f2 = makeForm('<input name="a" value="1"><input name="$ACTION_REF" value="abc">');
    expect(serializeForm(f1)).toBe(serializeForm(f2));
  });

  it("값에 구분자(=,&)가 있어도 충돌하지 않는다(JSON tuple)", () => {
    const f1 = makeForm('<input name="a" value="x=1&y=2"><input name="b" value="">');
    const f2 = makeForm('<input name="a" value="x"><input name="b" value="1&y=2">');
    expect(serializeForm(f1)).not.toBe(serializeForm(f2));
  });
});
