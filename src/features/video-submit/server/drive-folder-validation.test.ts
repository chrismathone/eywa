import { describe, expect, it, vi } from "vitest";
import { parseVideoFolder, requireEmptyVideoFolder, verifyVideoFolder } from "./drive-folder-validation";

describe("폴더 지정은 Google 메타와 실제 경로를 검증한다", () => {
  it("폴더 주소/번호만 받고 위장 호스트·파일·자바스크립트 주소는 거절한다", () => {
    expect(parseVideoFolder("https://drive.google.com/drive/u/0/folders/ROOT_FOLDER_123?usp=sharing")).toBe("ROOT_FOLDER_123");
    expect(parseVideoFolder("ROOT_FOLDER_123")).toBe("ROOT_FOLDER_123");
    for (const value of ["https://drive.google.com.evil.test/drive/folders/ROOT_FOLDER_123", "https://drive.google.com/file/d/ROOT_FOLDER_123/view", "javascript:alert(1)"])
      expect(parseVideoFolder(value)).toBeNull();
  });
  it("형제 폴더의 공유 부모를 포함하는 전체 조상 사슬을 반환한다", async () => {
    const request = vi.fn(async (url: string) => new Response(JSON.stringify({ id:url.includes("CHILD_FOLDER")?"CHILD_FOLDER":"PARENT_FOLDER", name:"지점", mimeType:"application/vnd.google-apps.folder", capabilities:{canAddChildren:true}, parents:url.includes("CHILD_FOLDER")?["PARENT_FOLDER"]:[] })));
    expect(await verifyVideoFolder(request,"CHILD_FOLDER",true)).toEqual({ folderName:"지점", ancestorIds:["CHILD_FOLDER","PARENT_FOLDER"] });
  });
  it("권한 없는 폴더·바로가기·휴지통 폴더는 받지 않는다", async () => {
    for (const meta of [{mimeType:"application/vnd.google-apps.folder",capabilities:{canAddChildren:false}}, {mimeType:"application/vnd.google-apps.shortcut"}, {mimeType:"application/vnd.google-apps.folder",trashed:true}])
      await expect(verifyVideoFolder(async () => new Response(JSON.stringify(meta)),"ROOT_FOLDER_123",true)).rejects.toThrow();
  });
  it("새 폴더에 기존 파일이 하나라도 있으면 거절하고 Drive에 쓰지 않는다", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({files:[{id:"FILE_ID"}]})));
    await expect(requireEmptyVideoFolder(request,"ROOT_FOLDER_123")).rejects.toThrow("비어 있어야");
    expect(request.mock.calls).toHaveLength(1);
  });
});
