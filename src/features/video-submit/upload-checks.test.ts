import { describe, expect, it } from "vitest";
import { HOMEWORK_VIDEO_MAX_BYTES } from "@/features/students/homework-video-limits";
import { startedWhileLinkOpen, UPLOAD_NOT_READY, uploadOrigin, verifyUploadedFile } from "./upload-checks";

describe("업로드 세션 출처", () => {
  it("요청이 온 그 사이트(https)만", () => {
    expect(uploadOrigin("https://www.aywa.co.kr", "www.aywa.co.kr")).toBe("https://www.aywa.co.kr");
    expect(uploadOrigin("https://evil.example", "www.aywa.co.kr")).toBe(null);
    expect(uploadOrigin("http://www.aywa.co.kr", "www.aywa.co.kr")).toBe(null);
    expect(uploadOrigin("http://localhost:3000", "localhost:3000")).toBe("http://localhost:3000");
    expect(uploadOrigin(null, "www.aywa.co.kr")).toBe(null);
    expect(uploadOrigin("not a url", "x")).toBe(null);
  });
});

describe("완료 확인 — Drive가 증거(브라우저 값을 믿지 않는다)", () => {
  const upload = { id: "u1", drive_file_id: "FILE_ABCDEFGHIJ", drive_folder_id: "FOLDER_ABCDEFG", bytes: 1234, created_at: "2026-10-01T01:00:00Z" };
  const good = {
    id: "FILE_ABCDEFGHIJ", size: "1234", md5Checksum: "0123456789abcdef0123456789abcdef", parents: ["FOLDER_ABCDEFG"], trashed: false,
    appProperties: { aywaSource: "link", aywaUpload: "u1" },
  };
  it("맞으면 통과", () => expect(verifyUploadedFile(good, upload)).toBe(null));
  it("다른 폴더·다른 크기·다른 번호·표식 없음·휴지통·해시 없음은 거절", () => {
    expect(verifyUploadedFile({ ...good, parents: ["OTHER_FOLDER_X"] }, upload)).toContain("담임 폴더");
    expect(verifyUploadedFile({ ...good, size: "1235" }, upload)).toContain("크기");
    expect(verifyUploadedFile({ ...good, id: "OTHER_FILE_XX" }, upload)).toContain("다른 파일");
    expect(verifyUploadedFile({ ...good, appProperties: { aywaSource: "link", aywaUpload: "u2" } }, upload)).toContain("제출 링크");
    expect(verifyUploadedFile({ ...good, appProperties: undefined }, upload)).toContain("제출 링크");
    expect(verifyUploadedFile({ ...good, trashed: true }, upload)).toContain("휴지통");
    // 해시가 아직 없으면 실패가 아니라 '조금 뒤 다시'(Drive가 늦게 채운다).
    expect(verifyUploadedFile({ ...good, md5Checksum: undefined }, upload)).toBe(UPLOAD_NOT_READY);
  });
  it("한도를 넘는 파일은 크기가 맞아도 거절", () => {
    const big = HOMEWORK_VIDEO_MAX_BYTES + 1;
    expect(verifyUploadedFile({ ...good, size: String(big) }, { ...upload, bytes: big })).toContain("허용 크기");
  });
});

describe("만료 전에 시작한 업로드만, 끊긴 링크는 언제든 거절", () => {
  const link = { expires_at: "2026-10-09T00:00:00+09:00", revoked_at: null };
  it("만료 전에 시작했으면 만료 뒤 끝나도 받는다", () => {
    expect(startedWhileLinkOpen({ created_at: "2026-10-08T14:59:00Z" }, link)).toBe(true);
    expect(startedWhileLinkOpen({ created_at: "2026-10-08T15:00:00Z" }, link)).toBe(false);
  });
  it("끊긴 링크는 끊기 전에 시작한 업로드도 받지 않는다('더 이상 올릴 수 없습니다')", () => {
    const revoked = { ...link, revoked_at: "2026-10-02T00:00:00Z" };
    expect(startedWhileLinkOpen({ created_at: "2026-10-01T23:00:00Z" }, revoked)).toBe(false);
    expect(startedWhileLinkOpen({ created_at: "2026-10-02T00:00:01Z" }, revoked)).toBe(false);
  });
});
