import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

/**
 * 읽기 권한 화면 공통 규칙(원장 2026-11-05 — `src/lib/write-lock.ts`) — 학원 설정 면 쪽.
 *  1. 저장·추가·삭제·동기화·보내기 단추는 **그리지 않는다**(비활성으로 남기지 않는다).
 *  2. 입력칸은 잠그고, 빈 칸 placeholder · 면 위 안내는 막은 권한 키를 적는다.
 * 판정 자체(서버 게이트와 같은 함수)는 page.tsx·면 서버 컴포넌트가 하고, 여기서는 받은 값대로 그리는지만 본다.
 */
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: vi.fn(), issueBrandingUploadTicket: vi.fn() }));
vi.mock("@/components/workspace/use-concurrent-edit-guard", () => ({
  useConcurrentEditGuard: () => ({ notifySaved: () => undefined, rebaseline: () => undefined }),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: () => undefined }) }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ tenantId: "tenant" }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/components/forms/form-action-bar", () => ({
  FormActionBar: ({ children }: { children: ReactNode }) => <div data-testid="action-bar">{children}</div>,
}));
vi.mock("@/features/notices/server/actions", () => ({
  createNoticePopup: vi.fn(), updateNoticePopup: vi.fn(), deleteNoticePopup: vi.fn(),
  regenerateNoticeTranslation: vi.fn(), toggleNoticePopupActive: vi.fn(),
}));
vi.mock("@/components/editor/menu-mention-editor", () => ({ MenuMentionEditor: () => <div data-testid="body-editor" /> }));
vi.mock("@/features/integrations/server/actions", () => ({
  setMakeeduSyncEnabled: vi.fn(), triggerMakeeduSyncNow: vi.fn(),
  checkMakeeduSyncLock: vi.fn(async () => ({ busyUntil: null, running: false })),
}));
vi.mock("@/features/owner/server/classroom-actions", () => ({
  createClassroom: vi.fn(), updateClassroom: vi.fn(), deleteClassroom: vi.fn(), setClassroomArchived: vi.fn(),
}));

import { SectionForm } from "./section-form";
import { HolidayListEditor, StringListEditor } from "./list-editors";
import { TextField } from "./fields";
import { BillingSection } from "./billing-section";
import { PopupsManager } from "./popups-manager";
import { MakeeduSyncCard } from "./makeedu-sync-card";
import { ClassroomManager } from "./classroom-manager";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { AdminPopup } from "@/features/notices/server/queries";
import type { ClassroomRow } from "@/features/owner/server/classroom-queries";

afterEach(cleanup);

const noop = () => undefined;

describe("섹션 폼 — 읽기 권한이면 저장 바·추가·삭제가 없다", () => {
  const renderForm = (readOnly: boolean) =>
    render(
      <SectionForm section="report" payload={{}} readOnly={readOnly}>
        <StringListEditor value={["304호"]} onChange={noop} addLabel="강의실 추가" placeholder="예: 304호" />
        <HolidayListEditor value={[{ date: "2026-12-25", name: "" }]} onChange={noop} />
        <TextField label="학원 이름" value="" onChange={noop} placeholder="예: 한빛학원" />
      </SectionForm>,
    );

  it("🔴 읽기 권한: 저장 바·추가·삭제 단추를 그리지 않고, 면 위 안내와 빈 칸 placeholder가 막은 권한 키(보고서 설정)를 적는다", () => {
    renderForm(true);
    expect(screen.queryByTestId("action-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    expect(screen.getByText(writeLockedNote("report_settings"))).toBeInTheDocument();
    expect(screen.getByLabelText("학원 이름")).toHaveAttribute("placeholder", writeLockedPlaceholder("report_settings"));
    // 예시 placeholder가 있던 칸(강의실 · 공휴일명 · 학원 이름)은 모두 권한 안내로 바뀌고 잠겨 있다(빈 칸에서 보인다).
    const locked = screen.getAllByPlaceholderText(writeLockedPlaceholder("report_settings"));
    expect(locked).toHaveLength(3);
    for (const el of locked) expect(el).toBeDisabled();
  });

  it("쓰기 권한: 종전 그대로 — 저장 바·추가·삭제가 있고 placeholder는 원래 예시다", () => {
    renderForm(false);
    expect(screen.getByTestId("action-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /강의실 추가/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /휴일 추가/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "삭제" })).toHaveLength(2);
    expect(screen.getByLabelText("학원 이름")).toHaveAttribute("placeholder", "예: 한빛학원");
  });
});

describe("수납·청구 면", () => {
  const billing = { ...DEFAULT_SETTINGS.billing, sessionPrices: [{ price: 30000, label: "" }] };

  it("🔴 읽기 권한이면 단가·계좌의 추가·삭제와 저장 바를 그리지 않는다", () => {
    render(<BillingSection initial={billing} readOnly />);
    expect(screen.queryByRole("button", { name: /단가 추가|계좌 추가/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
    expect(screen.queryByTestId("action-bar")).toBeNull();
    expect(screen.getByText(writeLockedNote("billing_settings"))).toBeInTheDocument();
  });
});

describe("팝업 공지 면", () => {
  const item = {
    id: "p1", title: "여름 특강", body: null, imageUrl: null, imageSrc: null, linkUrl: null, linkLabel: null,
    audience: "all", position: "cascade", width: 380, priority: 0, isActive: true, startsAt: null, endsAt: null,
    enStatus: "ready", enSkipReason: null,
  } as unknown as AdminPopup;

  it("🔴 읽기 권한이면 '새 팝업 공지' 양식과 줄마다의 영문·노출·수정·삭제 단추가 없다 — 상태는 글로 보인다", () => {
    const { container } = render(<PopupsManager items={[item]} canWrite={false} />);
    expect(screen.queryByText("새 팝업 공지")).toBeNull();
    expect(screen.queryByTestId("body-editor")).toBeNull();
    expect(container.querySelectorAll("button, input, form")).toHaveLength(0);
    expect(screen.getByText("여름 특강")).toBeInTheDocument();
    expect(screen.getByText("노출 중")).toBeInTheDocument();
    expect(screen.getByText(writeLockedNote("popup_settings"))).toBeInTheDocument();
  });

  it("쓰기 권한이면 종전 그대로 작성 양식이 선다", () => {
    render(<PopupsManager items={[item]} canWrite />);
    expect(screen.getByText("새 팝업 공지")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "팝업 생성" })).toBeInTheDocument();
  });
});

describe("makeedu 동기화 카드 — '지금 동기화'는 makeedu 연동(integrations) 권한", () => {
  const status = { enabled: true, lastSyncedAt: null } as unknown as Parameters<typeof MakeeduSyncCard>[0]["status"];
  const lock = { busyUntil: null, running: false };

  it("🔴 권한이 없으면 단추를 그리지 않고 안내만 적는다", () => {
    render(<MakeeduSyncCard status={status} initialLock={lock} canTrigger={false} />);
    expect(screen.queryByRole("button", { name: /지금 동기화/ })).toBeNull();
    expect(screen.getByText(writeLockedNote("integrations"))).toBeInTheDocument();
  });

  it("권한이 있으면 단추가 선다", () => {
    render(<MakeeduSyncCard status={status} initialLock={lock} />);
    expect(screen.getByRole("button", { name: /지금 동기화/ })).toBeInTheDocument();
  });
});

describe("강의실 카드", () => {
  const room = { id: "r1", name: "304호", capacity: 8, archivedAt: null, classCount: 0, staleDefaultCount: 0, slotCount: 0 } as unknown as ClassroomRow;

  it("🔴 읽기 권한이면 추가 양식과 수정·숨기기·삭제가 없다", () => {
    const { container } = render(<ClassroomManager rooms={[room]} readOnly />);
    expect(screen.getByText("304호")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("예: 304호")).toBeNull();
    expect(container.querySelectorAll("button, form")).toHaveLength(0);
  });
});
