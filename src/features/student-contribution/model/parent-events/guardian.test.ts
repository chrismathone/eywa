import { expect, it } from "vitest";
import { eventGuardianNames, eventGuardiansCompatible } from "./guardian";
import { matchEventIdentity } from "./identity";
import { verifiedEventSibling } from "./family";
import type { EventStudent } from "./types";

const child = (id = "a", guardianName = "가보호(모), 나보호(부)"): EventStudent => ({ id, tenantId: "t", name: id === "a" ? "가학생" : "나학생",
  guardianName, guardianPhone: "01023456789", school: "가람초", grade: "초3", schoolAsOf: "2026-10-26", eligible: true });
const form = { tenantId: "t", eventId: "e", sourceRef: "source", eventDate: "2026-07-01", studentName: "가학생", guardianName: "가보호",
  phones: ["01023456789"], school: "가람초", grade: "초3" };
it("matches one complete parent name to an explicitly labelled two-parent profile", () => {
  expect(eventGuardianNames("가보호 (모), 나보호 (부)")).toEqual(["가보호", "나보호"]);
  expect(eventGuardianNames("가보호(모)나보호(부)")).toEqual(["가보호", "나보호"]);
  expect(matchEventIdentity(form, [child()], [], "2026-10-26").state).toBe("matched");
  expect(matchEventIdentity({ ...form, studentName: "" }, [child()], [], "2026-10-26").state).toBe("matched");
  expect(verifiedEventSibling(child(), child("b", "가보호"), [])).toBe(true);
});
it("preserves real parent, phone, name-suffix and explicit sibling conflicts", () => {
  expect(eventGuardiansCompatible("가보호/다보호", "가보호/나보호")).toBe(false);
  expect(matchEventIdentity({ ...form, guardianName: "다보호" }, [child()], [], "2026-10-26").reasons).toContain("guardian_conflict");
  expect(matchEventIdentity({ ...form, phones: ["01034567890"] }, [child()], [], "2026-10-26").state).toBe("review");
  expect(matchEventIdentity({ ...form, studentName: "가학생A" }, [child()], [], "2026-10-26").state).toBe("review");
  expect(verifiedEventSibling(child(), child("b", "가보호"), [{ student_a: "a", student_b: "b", linked: false }])).toBe(false);
});
it.each(["학부모", "이름없음", "세컨폰", "보조번호", "연락처", "가보호 외 1인", "가보호(확인필요)", "가보호/보호자", "가보호 연락처 변경", "-", "unknown"])("does not treat %s as a confirmed parent", value => {
  expect(eventGuardianNames(value)).toEqual([]);
  expect(eventGuardiansCompatible(value, value)).toBe(false);
  expect(matchEventIdentity({ ...form, studentName: "", guardianName: value }, [child()], [], "2026-10-26").state).toBe("review");
});
it("does not silently skip a nonempty unparsed guardian, and handles a named grandparent explicitly", () => {
  expect(matchEventIdentity(form, [child("a", "다보호(이모)")], [], "2026-10-26").reasons).toContain("guardian_conflict");
  expect(matchEventIdentity(form, [child("a", "가보호(할머니)")], [], "2026-10-26").state).toBe("matched");
  expect(matchEventIdentity({ ...form, guardianName: "가학생" }, [child("a", "가보호(할머니)")], [], "2026-10-26").state).toBe("matched");
  expect(verifiedEventSibling(child("a", "세컨폰"), child("b", "세컨폰"), [])).toBe(false);
});
