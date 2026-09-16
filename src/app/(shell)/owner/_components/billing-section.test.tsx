import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { billingSchema, type BillingSettings } from "@/features/owner/settings-types";
import { BillingSection } from "./billing-section";

vi.mock("./section-form", () => ({
  SectionForm: ({ payload, children }: { payload: unknown; children: ReactNode }) => <form><output data-testid="payload">{JSON.stringify(payload)}</output>{children}</form>,
  SettingsCard: ({ title, children }: { title: string; children: ReactNode }) => <section><h3>{title}</h3>{children}</section>,
}));

it("단가 편집·추가·삭제와 EiE 변경이 모두 기존 설정 저장 payload에 실린다", () => {
  render(<BillingSection initial={DEFAULT_SETTINGS.billing} />);
  fireEvent.change(screen.getByLabelText(/회당 단가 1원/), { target: { value: "22000" } });
  fireEvent.click(screen.getByRole("button", { name: "단가 2 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "단가 추가" }));
  fireEvent.change(screen.getByLabelText(/회당 단가 13원/), { target: { value: "41000" } });
  fireEvent.change(screen.getByLabelText(/EiE 월 고정 금액/), { target: { value: "280000" } });
  const submitted = JSON.parse(screen.getByTestId("payload").textContent!) as BillingSettings;
  expect(billingSchema.safeParse(submitted).success).toBe(true);
  expect(submitted.sessionPrices.map((row) => row.price)).toContain(22000);
  expect(submitted.sessionPrices.map((row) => row.price)).not.toContain(22500);
  expect(submitted.sessionPrices.at(-1)?.price).toBe(41000);
  expect(submitted.eieMonthlyPrice).toBe(280000);
  expect(submitted.dueDay).toBe(DEFAULT_SETTINGS.billing.dueDay);
});
