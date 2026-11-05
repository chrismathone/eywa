import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { LiveSplits } from "./splits-snapshot-panel";
vi.mock("next/navigation", () => ({ useRouter: () => ({push:vi.fn(),replace:vi.fn()}), usePathname:()=>"/billing",useSearchParams:()=>new URLSearchParams() }));
const m = vi.hoisted(() => ({ rows: [{
  id:"r", invoiceId:"invoice", classId:"class", subject:"math", className:"합성반", studentName:"가학생", studentGrade:null,
  teacherId:"teacher", teacherName:"합성강사", confirmedSessions:4, plannedSessions:4, actualConsumed:4,
  unitPrice:10000, amount:40000, pricingMode:"per_session", status:"matched", diff:0, note:null, termState:"term",
}] }));
vi.mock("@/features/billing/session-terms/server/verification-queries", () => ({ getSessionVerificationView: async () => ({ rows:m.rows, counts:{total:1,over:0,short:0,matched:1,monthly:0,unconfirmed:0} }) }));
vi.mock("@/features/billing/session-terms/server/splits-queries", () => ({getTeacherSplitsStatus:async()=>null}));
vi.mock("@/features/owner/server/queries", () => ({getTenantSettings:async()=>DEFAULT_SETTINGS}));
vi.mock("./splits-snapshot-panel", () => ({SplitsSnapshotPanel:({live}:{live:LiveSplits})=><div data-testid="split-snapshot">{JSON.stringify(live)}</div>}));
vi.mock("@/components/filter-select", () => ({FilterSelect:()=>null}));
vi.mock("@/components/search-toggle", () => ({SearchToggle:()=>null}));
import { SessionVerificationFace } from "./session-verification-face";
afterEach(cleanup);
it.each([{query:"없는이름"},{status:"over"}])("검색/판정 0건은 월 데이터와 분배 스냅샷을 숨기지 않는다: %j", async (filter) => {
  render(await SessionVerificationFace({period:"2026-10",canWrite:true,...filter,params:{q:"없는이름",status:"over",embed:"1",lang:"en",page:"3",subject:"math"}}));
  expect(screen.queryByText(/이 달의 회차 데이터가 없습니다/)).toBeNull();
  expect(screen.getByText(/조건에 맞는 학생이 없습니다/)).toBeInTheDocument();
  expect(screen.getByText("강사별 청구 금액 (참고)")).toBeInTheDocument();
  expect(screen.getByText("합성강사")).toBeInTheDocument();
  expect(screen.getByTestId("split-snapshot")).toHaveTextContent('"confirmedAmount":40000');
  const url=new URL(screen.getByRole("link",{name:"검색·판정 해제"}).getAttribute("href")!,"https://test.invalid");
  expect(url.searchParams.has("q")).toBe(false); expect(url.searchParams.has("status")).toBe(false);
  expect(url.searchParams.has("page")).toBe(false); expect(url.searchParams.get("embed")).toBe("1");
  expect(url.searchParams.get("lang")).toBe("en"); expect(url.searchParams.get("subject")).toBe("math");
  expect(url.searchParams.get("tab")).toBe("sessions"); expect(url.searchParams.get("panel")).toBe("verify");
});
