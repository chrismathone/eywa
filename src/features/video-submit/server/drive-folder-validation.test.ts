import { describe, expect, it, vi } from "vitest";
import { parseVideoFolder, requireCompleteChain, requireEmptyVideoFolder, verifyVideoFolder, VideoFolderValidationError } from "./drive-folder-validation";

const FOLDER = "application/vnd.google-apps.folder";
type Meta = { parents?: string[]; driveId?: string; name?: string };
/** 폴더 번호 → 메타. `files/root`는 이 계정의 내 드라이브 맨 위(`MY_DRIVE_ROOT_1`)를 답한다. */
function drive(folders: Record<string, Meta>) {
  return vi.fn(async (url: string) => {
    if (url.includes("/files/root?")) return new Response(JSON.stringify({ id: "MY_DRIVE_ROOT_1" }));
    const id = /\/files\/([A-Za-z0-9_-]+)\?/.exec(url)?.[1] ?? "";
    const meta = folders[id];
    if (!meta) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ id, name: meta.name ?? "지점", mimeType: FOLDER, capabilities: { canAddChildren: true }, parents: meta.parents ?? [], driveId: meta.driveId }));
  });
}

describe("폴더 지정은 Google 메타와 실제 경로를 검증한다", () => {
  it("폴더 주소/번호만 받고 위장 호스트·파일·자바스크립트 주소는 거절한다", () => {
    expect(parseVideoFolder("https://drive.google.com/drive/u/0/folders/ROOT_FOLDER_123?usp=sharing")).toBe("ROOT_FOLDER_123");
    expect(parseVideoFolder("ROOT_FOLDER_123")).toBe("ROOT_FOLDER_123");
    for (const value of ["https://drive.google.com.evil.test/drive/folders/ROOT_FOLDER_123", "https://drive.google.com/file/d/ROOT_FOLDER_123/view", "javascript:alert(1)"])
      expect(parseVideoFolder(value)).toBeNull();
  });
  it("내 드라이브 안의 폴더 — 맨 위까지의 경로 전체를 돌려주고 온전한 경로로 본다", async () => {
    const request = drive({ CHILD_FOLDER_1: { parents: ["PARENT_FOLDER"] }, PARENT_FOLDER: { parents: ["MY_DRIVE_ROOT_1"] }, MY_DRIVE_ROOT_1: {} });
    const verified = await verifyVideoFolder(request, "CHILD_FOLDER_1", true);
    expect(verified).toEqual({ folderName: "지점", ancestorIds: ["CHILD_FOLDER_1", "PARENT_FOLDER", "MY_DRIVE_ROOT_1"], chainComplete: true });
    expect(() => requireCompleteChain(verified)).not.toThrow();
  });
  it("🔴 다른 계정이 공유해 준 폴더는 위 폴더가 안 보여 경로가 끊긴다 — 온전하지 않은 경로로 보고 새 저장 폴더로 받지 않는다", async () => {
    // 공유받은 폴더: 부모가 이 계정에 안 보인다(parents 없음). 다른 지점 저장 폴더의 안쪽이어도 이 계정으로는 알 수 없다.
    const shared = await verifyVideoFolder(drive({ SHARED_FOLDER_1: {} }), "SHARED_FOLDER_1", true);
    expect(shared).toMatchObject({ ancestorIds: ["SHARED_FOLDER_1"], chainComplete: false });
    expect(() => requireCompleteChain(shared)).toThrow(VideoFolderValidationError);
    // 부모까지는 보이지만 그 위가 남의 드라이브인 경우도 같다.
    const nested = await verifyVideoFolder(drive({ CHILD_FOLDER_1: { parents: ["THEIR_FOLDER_1"] }, THEIR_FOLDER_1: {} }), "CHILD_FOLDER_1", true);
    expect(nested.chainComplete).toBe(false);
  });
  it("공유 드라이브는 그 드라이브 맨 위까지 이어질 때만 온전하다(안쪽 폴더만 공유받은 경우는 아니다)", async () => {
    const whole = await verifyVideoFolder(drive({ TEAM_FOLDER_01: { parents: ["TEAM_DRIVE_01"], driveId: "TEAM_DRIVE_01" }, TEAM_DRIVE_01: { driveId: "TEAM_DRIVE_01" } }), "TEAM_FOLDER_01", true);
    expect(whole.chainComplete).toBe(true);
    const partial = await verifyVideoFolder(drive({ TEAM_FOLDER_01: { driveId: "TEAM_DRIVE_01" } }), "TEAM_FOLDER_01", true);
    expect(partial.chainComplete).toBe(false);
  });
  it("권한 없는 폴더·바로가기·휴지통 폴더는 받지 않는다", async () => {
    for (const meta of [{mimeType:FOLDER,capabilities:{canAddChildren:false}}, {mimeType:"application/vnd.google-apps.shortcut"}, {mimeType:FOLDER,trashed:true}])
      await expect(verifyVideoFolder(async () => new Response(JSON.stringify(meta)),"ROOT_FOLDER_123",true)).rejects.toThrow();
  });
  it("새 폴더에 기존 파일이 하나라도 있으면 거절하고 Drive에 쓰지 않는다", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({files:[{id:"FILE_ID"}]})));
    await expect(requireEmptyVideoFolder(request,"ROOT_FOLDER_123")).rejects.toThrow("비어 있어야");
    expect(request.mock.calls).toHaveLength(1);
  });
});
