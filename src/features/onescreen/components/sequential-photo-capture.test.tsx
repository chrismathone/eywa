import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PhotoEntry, PhotoTarget } from "../sequential-photo";
import { SequentialPhotoCapture } from "./sequential-photo-capture";

const take = vi.hoisted(() => vi.fn());
vi.mock("../resize-image", () => ({ resizeImageForUpload: (file: File) => Promise.resolve(file) }));
vi.mock("./photo-markup-editor", () => ({ PhotoMarkupEditor: ({ onApply }: { onApply: (file: File) => void }) => <button onClick={() => onApply(new File(["edited"], "edited.jpg", { type: "image/jpeg" }))}>편집 적용</button> }));
vi.mock("./photo-camera-panel", () => ({ PhotoCameraPanel: ({ entry, index, onPhoto, onMove, onReview }: {
  entry: PhotoEntry; index: number; onPhoto: (fn: () => Promise<File>) => void; onMove: (index: number) => void; onReview: () => void;
}) => <div><p>{entry.target.name}</p><button onClick={() => onPhoto(take)}>촬영</button><button onClick={() => onMove(index + 1)}>건너뛰기</button><button onClick={onReview}>사진 확인</button></div> }));

const target = (id: string): PhotoTarget => ({ key: id, studentId: id, subjectName: "영어", classId: "jj", className: "JJ1A", name: `학생${id}`, date: "2026-10-29", capacity: 6 });
const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const attach = vi.fn();
const onUploadingChange = vi.fn();
beforeEach(() => {
  take.mockReset(); attach.mockReset(); onUploadingChange.mockReset();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:photo");
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const setup = (targets = [target("a"), target("b"), target("c")]) => render(<SequentialPhotoCapture targets={targets} onAttach={attach} onUploadingChange={onUploadingChange} onClose={vi.fn()} />);

it("셔터마다 표 순서로 배정하되 건너뛴 학생을 유지하고 확인 전에는 업로드하지 않는다", async () => {
  take.mockResolvedValueOnce(file("a.jpg")).mockResolvedValueOnce(file("c.jpg"));
  setup();
  const body = screen.getByRole("dialog").querySelector<HTMLDivElement>(".min-h-0")!;
  body.scrollTop = 400;
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("학생b");
  expect(body.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  await screen.findByText("학생c");
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("2개 수업 · 첨부할 사진 2장");
  expect(screen.getByText("사진 없음 · 건너뜀")).toBeTruthy();
  expect(attach).not.toHaveBeenCalled();
  attach.mockResolvedValue(1);
  fireEvent.click(screen.getByRole("button", { name: "확인한 사진 2장 첨부" }));
  await screen.findByText("사진 2장을 학생별로 첨부했습니다.");
  expect(attach.mock.calls.map(([t, files]) => [t.studentId, t.classId, t.date, files[0].name])).toEqual([
    ["a", "jj", "2026-10-29", "a.jpg"], ["c", "jj", "2026-10-29", "c.jpg"],
  ]);
  expect(onUploadingChange.mock.calls.map(([b]) => b)).toEqual([true, false]);
});
it("촬영 실패 때 같은 학생에 머무르며 중복 셔터를 막는다", async () => {
  let reject!: (error: Error) => void;
  take.mockReturnValue(new Promise<File>((_, r) => { reject = r; }));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  expect(take).toHaveBeenCalledTimes(1);
  reject(new Error("encode failed"));
  await screen.findByRole("alert");
  expect(screen.getByText("학생a")).toBeTruthy();
  expect(attach).not.toHaveBeenCalled();
});
it("재촬영은 해당 사진만 바꾸고 추가 촬영도 같은 수업으로 첨부한다", async () => {
  take.mockResolvedValueOnce(file("old.jpg")).mockResolvedValueOnce(file("new.jpg")).mockResolvedValueOnce(file("extra.jpg"));
  setup([target("a")]);
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("1개 수업 · 첨부할 사진 1장");
  fireEvent.click(screen.getByRole("button", { name: "다시 찍기" }));
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("1개 수업 · 첨부할 사진 1장");
  fireEvent.click(screen.getByRole("button", { name: "추가 촬영" }));
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("1개 수업 · 첨부할 사진 2장");
  attach.mockResolvedValue(1);
  fireEvent.click(screen.getByRole("button", { name: "확인한 사진 2장 첨부" }));
  await screen.findByText("사진 2장을 학생별로 첨부했습니다.");
  expect(attach.mock.calls.map(([t, files]) => [t.studentId, files[0].name])).toEqual([["a", "new.jpg"], ["a", "extra.jpg"]]);
});
it("부분 실패는 확인 화면에 남고 재시도 때 성공 사진을 중복 첨부하지 않는다", async () => {
  take.mockResolvedValueOnce(file("a.jpg")).mockResolvedValueOnce(file("b.jpg"));
  setup([target("a"), target("b")]);
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("학생b");
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("2개 수업 · 첨부할 사진 2장");
  attach.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  fireEvent.click(screen.getByRole("button", { name: "확인한 사진 2장 첨부" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByRole("button", { name: "확인한 사진 1장 첨부" })).not.toBeDisabled());
  expect(within(screen.getByText("1. 학생a").closest("section")!).getByText("1장 첨부 완료")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "확인한 사진 1장 첨부" }));
  await screen.findByText("사진 2장을 학생별로 첨부했습니다.");
  expect(attach.mock.calls.map(([t]) => t.studentId)).toEqual(["a", "b", "b"]);
});

it("같은 사진 파일을 두 번 추가해도 꾸미기는 선택한 한 장만 바꾸고 수정본을 첨부한다", async () => {
  const original = file("original.jpg");
  take.mockResolvedValue(original);
  setup([target("a")]);
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("1개 수업 · 첨부할 사진 1장");
  fireEvent.click(screen.getByRole("button", { name: "추가 촬영" }));
  fireEvent.click(screen.getByRole("button", { name: "촬영" }));
  await screen.findByText("1개 수업 · 첨부할 사진 2장");
  fireEvent.click(screen.getAllByRole("button", { name: "사진 꾸미기" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "편집 적용" }));
  attach.mockResolvedValue(1);
  fireEvent.click(screen.getByRole("button", { name: "확인한 사진 2장 첨부" }));
  await screen.findByText("사진 2장을 학생별로 첨부했습니다.");
  expect(attach.mock.calls.map(([, files]) => files[0].name)).toEqual(["edited.jpg", "original.jpg"]);
});
