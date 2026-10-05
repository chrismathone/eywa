import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MakeupCaseDetail } from "../server/read-types";
import { SessionOperations } from "./session-operations";
import { detail, fulfillment, participant, periods, session, uuid } from "./ui-test-fixtures";
import { EmbedProvider } from "@/components/workspace/embed-context";

vi.mock("./command-form", () => ({ CommandForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("./session-fields", () => ({ SessionFields: () => <p>변경할 날짜</p> }));
vi.mock("./option-picker", () => ({ OptionPicker: () => null }));
vi.mock("./fulfillment-review", () => ({ FulfillmentReview: () => null }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-10-05" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }));
const view = (data: MakeupCaseDetail, recordView: "teacher" | "attendance" = "teacher", actorId = uuid(4)) =>
  <SessionOperations detail={data} periods={periods} actorId={actorId} {...{ recordView }} />;
const withToday = (data: MakeupCaseDetail) => ({ ...data, today: "2026-10-05" }) as MakeupCaseDetail;

describe("회차별 작업과 기록 목적지", () => {
  it("구형 응답에서도 미래 회차에는 참여 기록과 링크를 숨긴다", () => {
    render(view(detail({ sessions: [session({ session_date: "2026-10-06" })] })));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByText(/실시 날짜가 된 후 기록할 수 있습니다/).length).toBeGreaterThan(0);
  });
  it("구형 응답에서도 인정된 참여에는 참여 기록과 검토 제출을 숨긴다", () => {
    render(view(withToday(detail({ participants: [participant({ status: "partial" })], fulfillments: [fulfillment({ state: "verified" })] }))));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
    expect(screen.queryByText("실시 기록 검토 제출")).toBeNull();
    expect(screen.getAllByText(/이미 인정된 기록입니다/).length).toBeGreaterThan(0);
  });
  it("케이스 권한만 있어도 다른 실시 강사의 기록과 일정 변경은 표시하지 않는다", () => {
    render(view(withToday(detail()), "teacher", uuid(30)));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
    expect(screen.queryByText("이 학생의 일정 변경")).toBeNull();
    expect(screen.getAllByText(/이 회차를 맡은 강사가 처리할 수 있습니다/).length).toBeGreaterThan(0);
  });
  it("구형 응답의 비활성 회차와 권한 없는 케이스에도 기록을 표시하지 않는다", () => {
    const rendered = render(view(withToday(detail({ sessions: [session({ state: "rescheduled" })] }))));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
    rendered.rerender(view(withToday(detail({ permissions: {} }))));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
  });
  it("참여별 action과 차단 사유를 사용하고 원시 코드는 표시하지 않는다", () => {
    const p = participant({ actions: { record: false, submit: false, cancel: false, reschedule: false },
      blocked: { record: "future_session", submit: "no_open_record", cancel: "already_recorded", reschedule: "not_conductor" } });
    render(view(detail({ participants: [p] })));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
    expect(screen.getByText(/실시 날짜가 된 후 기록할 수 있습니다/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/future_session|no_open_record|already_recorded|not_conductor/);
  });
  it("교사 기록 링크가 학생·앵커 반·복귀 경로와 embed를 포함한다", () => {
    render(<EmbedProvider embed>{view(withToday(detail()))}</EmbedProvider>);
    const link = screen.getByRole("link", { name: "수업 기록에서 출결·보고서 작성" });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/onescreen");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ date: "2026-10-05", student: uuid(2), class: uuid(3), return: `/makeups/${uuid(1)}`, embed: "1" });
  });
  it("비교사 보기에는 해당 반 월별 출석부와 실시 강사 기록 안내를 제공한다", () => {
    render(view(withToday(detail({ permissions: { assign: true, participation: true } })), "attendance", uuid(30)));
    const url = new URL(screen.getByRole("link", { name: /출석부/ }).getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/attendance");
    expect(Object.fromEntries(url.searchParams)).toEqual({ class: uuid(3), month: "2026-10" });
    expect(screen.getByText(/실시 강사의 수업 기록/)).toBeTruthy();
  });
  it("구형 응답의 활성 초안만 검토 제출을 제공한다", () => {
    render(view(withToday(detail({ participants: [participant({ status: "partial" })], fulfillments: [fulfillment({ state: "reversed" })] }))));
    expect(screen.queryByText("실시 기록 검토 제출")).toBeNull();
  });
  it("수기 인정 완료와 출결 미연결을 별도로 표시한다", () => {
    render(view(withToday(detail({ participants: [participant({ status: "partial", attendance_link: "none" })],
      fulfillments: [fulfillment({ state: "verified", evidence_kind: "manual" })] }))));
    expect(screen.getByText(/실시 인정 · 인정 완료/)).toBeTruthy();
    expect(screen.getByText(/출결 연결 · 연결된 출결 없음/)).toBeTruthy();
  });
  it.each([["pending", "연결 확인 대기"], ["failed", "연결 확인 실패"], ["linked", "연결됨"]])("출결 %s 상태와 인정 완료를 각각 표시한다", (state, label) => {
    render(view(detail({ participants: [participant({ attendance_link: state })], fulfillments: [fulfillment({ state: "verified" })] })));
    expect(screen.getByText("실시 인정 · 인정 완료")).toBeTruthy();
    expect(screen.getByText(`출결 연결 · ${label}`)).toBeTruthy();
  });
  it("새 필드가 없으면 기존 참여자별 반영 작업으로 연결 상태를 표시한다", () => {
    render(view(detail({ projection_jobs: [{ id: uuid(45), revision: 1, state: "pending", kind: "attendance_effect",
      effect_key: `att:${uuid(7)}`, participant_ids: [uuid(7)] }] })));
    expect(screen.getByText("출결 연결 · 연결 확인 대기")).toBeTruthy();
  });
  it("한 건의 여러 회차 중 오늘 기록할 참여자에게만 기록 폼을 제공한다", () => {
    render(view(detail({
      sessions: [session(), session({ id: uuid(50), session_date: "2026-10-06" }), session({ id: uuid(51), session_date: "2026-10-04" })],
      participants: [participant(), participant({ id: uuid(52), session_id: uuid(50) }), participant({ id: uuid(53), session_id: uuid(51), status: "partial" })],
      fulfillments: [fulfillment({ participant_id: uuid(53), state: "verified" })],
    })));
    expect(screen.getAllByText("참여 기록·출결 연결")).toHaveLength(1);
    const future = screen.getByRole("heading", { level: 3, name: /2026-10-06/ }).parentElement!;
    const verified = screen.getByRole("heading", { level: 3, name: /2026-10-04/ }).parentElement!;
    expect(within(future).queryByText("참여 기록·출결 연결")).toBeNull();
    expect(within(verified).queryByText("참여 기록·출결 연결")).toBeNull();
  });
  it("부분적인 새 action 필드가 있으면 빠진 작업은 구형 응답 검사를 따른다", () => {
    render(view(detail({ participants: [participant({ actions: { record: false }, blocked: { record: "future_session" } })] })));
    expect(screen.queryByText("참여 기록·출결 연결")).toBeNull();
    expect(screen.getByText("이 학생의 일정 변경")).toBeTruthy();
    expect(screen.getByText("이 학생의 예약 취소")).toBeTruthy();
  });
  it("반이 없으면 비교사에게 엉뚱한 출석부 링크를 제공하지 않는다", () => {
    render(view(detail({ participants: [participant({ anchor_class_id: null })] }), "attendance"));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/출결·보고서 반을 지정한 뒤/)).toBeTruthy();
  });
  it("반이 없으면 교사에게도 학생을 찾을 수 없는 수업 기록 링크를 제공하지 않는다", () => {
    render(view(detail({ participants: [participant({ anchor_class_id: null })] }), "teacher"));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/출결·보고서 반을 지정한 뒤/)).toBeTruthy();
  });
  it("구형 연결 상태는 출결 반영 작업만 반영하고 다른 효과 실패는 제외한다", () => {
    render(view(detail({ projection_jobs: [
      { id: uuid(45), revision: 1, state: "pending", kind: "attendance_effect", effect_key: `att:${uuid(7)}`, participant_id: uuid(7) },
      { id: uuid(46), revision: 1, state: "failed", kind: "effect_gap", effect_key: `gap:units_review:att:${uuid(7)}`, participant_ids: [uuid(7)] },
    ] })));
    expect(screen.getByText("출결 연결 · 연결 확인 대기")).toBeTruthy();
  });
  it("연결된 출결이 있을 때 관계 없는 실패나 다른 참여자의 반영 실패로 바꾸지 않는다", () => {
    render(view(detail({ participants: [participant({ attendance_record_id: uuid(47) })], projection_jobs: [
      { id: uuid(45), revision: 1, state: "failed", kind: "attendance_effect", effect_key: `att:${uuid(48)}`, participant_ids: [uuid(7)] },
      { id: uuid(46), revision: 1, state: "failed", kind: "effect_gap", effect_key: `gap:units_review:att:${uuid(7)}`, participant_id: uuid(7) },
    ] })));
    expect(screen.getByText("출결 연결 · 연결됨")).toBeTruthy();
  });
});
