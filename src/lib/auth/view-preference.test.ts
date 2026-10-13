import { expect, it } from "vitest";
import { accessFallbackPath, VIEW_RESET_PATH } from "./view-preference";

it.each(["/onescreen", "/ecs", "/dashboard"])("breaks a denied %s home loop", path => {
  expect(accessFallbackPath(path, path)).toBe(VIEW_RESET_PATH);
  expect(accessFallbackPath(`${path}/?embed=1`, `${path}#today`)).toBe(VIEW_RESET_PATH);
});
it("preserves normal home redirection", () => {
  expect(accessFallbackPath("/dashboard", "/onescreen")).toBe("/onescreen");
  expect(accessFallbackPath("/ecs", "/onescreen")).toBe("/onescreen");
});
