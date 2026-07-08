import { describe, it, expect } from "vitest";
import {
  classifyAudioPath,
  isLegacyFirebasePath,
  isTenantAudioPath,
  isTenantBrandingPath,
  isTenantReceiptPath,
  isTenantReportAttachmentPath,
} from "./legacy-audio-path";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";

describe("isTenantAudioPath", () => {
  it("테넌트 단일 객체키만 통과", () => {
    expect(isTenantAudioPath(`${TENANT}/abc123.webm`, TENANT)).toBe(true);
    expect(isTenantAudioPath(`${TENANT}/sub/abc.webm`, TENANT)).toBe(false); // 하위경로
    expect(isTenantAudioPath(`other/abc.webm`, TENANT)).toBe(false);
    expect(isTenantAudioPath(`meeting-recordings/고등관회의.webm`, TENANT)).toBe(false); // 레거시
  });
});

describe("isLegacyFirebasePath — kind별 prefix + 한글 허용", () => {
  it("kind prefix + 한글 파일명 통과", () => {
    expect(isLegacyFirebasePath("meeting-recordings/고등관회의_2026-04-17_177.webm", "meeting")).toBe(true);
    expect(isLegacyFirebasePath("consultation-recordings/미등록_상담.m4a", "consultation")).toBe(true);
    expect(isLegacyFirebasePath("registration-recordings/이윤건_2026-05-22.webm", "registration")).toBe(true);
  });

  it("다른 kind prefix면 거부(교차접근 차단)", () => {
    expect(isLegacyFirebasePath("registration-recordings/이윤건.webm", "meeting")).toBe(false);
    expect(isLegacyFirebasePath("consultation-recordings/x.webm", "meeting")).toBe(false);
  });

  it("path traversal·다중세그먼트·확장자 없음·선행점 거부", () => {
    expect(isLegacyFirebasePath("meeting-recordings/../secret.webm", "meeting")).toBe(false);
    expect(isLegacyFirebasePath("meeting-recordings/sub/x.webm", "meeting")).toBe(false);
    expect(isLegacyFirebasePath("meeting-recordings/noext", "meeting")).toBe(false);
    expect(isLegacyFirebasePath("meeting-recordings/.hidden.webm", "meeting")).toBe(false);
    expect(isLegacyFirebasePath("meeting-recordings/", "meeting")).toBe(false);
    expect(isLegacyFirebasePath("meeting-recordings/back\\slash.webm", "meeting")).toBe(false);
  });
});

describe("classifyAudioPath", () => {
  it("tenant / legacy / invalid 분기", () => {
    expect(classifyAudioPath(`${TENANT}/u.webm`, "meeting", TENANT)).toBe("tenant");
    expect(classifyAudioPath("meeting-recordings/회의.webm", "meeting", TENANT)).toBe("legacy");
    // legacy지만 kind 불일치 → invalid
    expect(classifyAudioPath("registration-recordings/x.webm", "meeting", TENANT)).toBe("invalid");
    expect(classifyAudioPath("garbage", "meeting", TENANT)).toBe("invalid");
  });
});

describe("isTenantReceiptPath — {tenant}/{expenseId}/{file} 2세그먼트", () => {
  it("통과/거부", () => {
    expect(isTenantReceiptPath(`${TENANT}/exp123/abc.png`, TENANT)).toBe(true);
    expect(isTenantReceiptPath(`${TENANT}/exp123/scan.pdf`, TENANT)).toBe(true);
    expect(isTenantReceiptPath(`${TENANT}/abc.png`, TENANT)).toBe(false); // 1세그먼트(오디오 꼴)
    expect(isTenantReceiptPath(`${TENANT}/exp/sub/abc.png`, TENANT)).toBe(false); // 3세그먼트
    expect(isTenantReceiptPath(`other/exp/abc.png`, TENANT)).toBe(false);
    expect(isTenantReceiptPath(`${TENANT}/exp/noext`, TENANT)).toBe(false);
  });
});

describe("isTenantBrandingPath — {tenant}/branding/{file}", () => {
  it("통과/거부", () => {
    expect(isTenantBrandingPath(`${TENANT}/branding/logo.png`, TENANT)).toBe(true);
    expect(isTenantBrandingPath(`${TENANT}/branding/seal.svg`, TENANT)).toBe(true);
    expect(isTenantBrandingPath(`${TENANT}/logo.png`, TENANT)).toBe(false); // branding 폴더 없음
    expect(isTenantBrandingPath(`${TENANT}/branding/../x.png`, TENANT)).toBe(false);
    expect(isTenantBrandingPath(`other/branding/logo.png`, TENANT)).toBe(false);
  });
});

describe("isTenantReportAttachmentPath — {tenant}/report-attachments/{file}", () => {
  it("통과/거부", () => {
    expect(isTenantReportAttachmentPath(`${TENANT}/report-attachments/abc.jpg`, TENANT)).toBe(true);
    expect(isTenantReportAttachmentPath(`${TENANT}/report-attachments/photo.webp`, TENANT)).toBe(true);
    expect(isTenantReportAttachmentPath(`${TENANT}/abc.jpg`, TENANT)).toBe(false); // 폴더 없음
    expect(isTenantReportAttachmentPath(`${TENANT}/documents/abc.jpg`, TENANT)).toBe(false); // 다른 폴더
    expect(isTenantReportAttachmentPath(`${TENANT}/report-attachments/../x.jpg`, TENANT)).toBe(false); // traversal
    expect(isTenantReportAttachmentPath(`${TENANT}/report-attachments/sub/x.jpg`, TENANT)).toBe(false); // 하위경로
    expect(isTenantReportAttachmentPath(`other/report-attachments/abc.jpg`, TENANT)).toBe(false); // 교차테넌트
    expect(isTenantReportAttachmentPath(`${TENANT}/report-attachments/noext`, TENANT)).toBe(false); // 확장자 없음
  });
});
