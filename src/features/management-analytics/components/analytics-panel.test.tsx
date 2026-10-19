import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPanel } from "./analytics-panel";
import { DATASETS, DATASET_LABELS } from "../contract";
import { SAMPLE_CSV } from "../sample";
import { normalizeData } from "../normalize";
import { calculateKpis, monthlyKpis } from "../calc";
import { sampleOptions } from "../test-fixtures";

function response() {
  const options = sampleOptions(), result = normalizeData(SAMPLE_CSV, options);
  const period = { from: options.from, to: options.to };
  return { ok: true, report: { period, asOf: options.asOf, generatedAt: "2026-10-19T00:00:00Z", quality: result.quality, kpis: calculateKpis(result.data, period), months: monthlyKpis(result.data, period) } };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("analytics upload workflow", () => {
  it("loads synthetic data, renders verified results and invalidates changed dates", async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => response() }); vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup(); render(<AnalyticsPanel tenantId="tenant-a" today="2026-10-19" />);
    expect(screen.getByRole("button", { name: "검증하고 분석하기" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "가상 샘플 불러오기" }));
    await user.click(screen.getByRole("button", { name: "검증하고 분석하기" }));
    expect(await screen.findByRole("region", { name: "경영분석 결과" })).toHaveTextContent("1,050,000");
    expect(screen.getByRole("heading", { name: /가상 샘플 분석/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("조회 종료일"), { target: { value: "2026-09-29" } });
    expect(screen.queryByRole("region", { name: "경영분석 결과" })).not.toBeInTheDocument();
    const form = fetch.mock.calls[0][1].body as FormData;
    expect(form.get("tenantId")).toBe("tenant-a");
    expect(JSON.parse(String(form.get("options"))).encoding).toBe("utf-8");
  });
  it("never mixes a real file with leftover synthetic datasets", async () => {
    const user = userEvent.setup(); render(<AnalyticsPanel tenantId="tenant-a" today="2026-10-19" />);
    await user.click(screen.getByRole("button", { name: "가상 샘플 불러오기" }));
    await user.upload(screen.getByLabelText("입퇴원 이력 CSV"), new File([SAMPLE_CSV.enrollments], "real.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getAllByText(/파일 선택 완료/)).toHaveLength(1));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "검증하고 분석하기" })).toBeDisabled();
  });
  it("omits private columns and filenames before fetch", async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => response() }); vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup(); render(<AnalyticsPanel tenantId="tenant-a" today="2026-10-19" />);
    for (const d of DATASETS) {
      const lines = SAMPLE_CSV[d].trim().split("\n");
      const text = lines.map((line, i) => `${line},${i ? "PRIVATE_NAME" : "이름"}`).join("\n");
      await user.upload(screen.getByLabelText(`${DATASET_LABELS[d]} CSV`), new File([text], "PRIVATE_FILENAME.csv", { type: "text/csv" }));
    }
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검증하고 분석하기" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const form = fetch.mock.calls[0][1].body as FormData;
    for (const d of DATASETS) {
      const file = form.get(d) as File;
      expect(file.name).toBe(`${d}.csv`); expect(await file.text()).not.toContain("PRIVATE_NAME");
    }
  });
  it("clearing aborts an in-flight request and ignores late responses", async () => {
    let resolve: (value: unknown) => void = () => {};
    const fetch = vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; })); vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup(); render(<AnalyticsPanel tenantId="tenant-a" today="2026-10-19" />);
    await user.click(screen.getByRole("button", { name: "가상 샘플 불러오기" }));
    await user.click(screen.getByRole("button", { name: "검증하고 분석하기" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "자료 비우기" }));
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ json: async () => response() });
    await waitFor(() => expect(screen.queryByRole("region", { name: "경영분석 결과" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "검증하고 분석하기" })).toBeDisabled();
  });
  it("shows validation errors and never a partial KPI report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: "데이터 오류를 수정해 주세요.", issueCount: 1, issues: [{ dataset: "payments", row: 2, field: "amount", message: "금액을 확인해 주세요." }] }) }));
    const user = userEvent.setup(); render(<AnalyticsPanel tenantId="tenant-a" today="2026-10-19" />);
    await user.click(screen.getByRole("button", { name: "가상 샘플 불러오기" }));
    await user.click(screen.getByRole("button", { name: "검증하고 분석하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("금액을 확인해 주세요.");
    expect(screen.queryByRole("region", { name: "경영분석 결과" })).not.toBeInTheDocument();
  });
});
