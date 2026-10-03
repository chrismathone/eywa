import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import type { NoticeSkip } from "./notice-targets";
export type ClassNoticeInput = {
  classIds: string[];
  body: string;
  individual?: Record<string, string>;
  attachments?: NoticeAttachment[];
  test?: boolean;
  previewFingerprint?: string;
};
export type ClassNoticePreview = {
  fingerprint: string;
  classCount: number;
  studentCount: number;
  individualCount: number;
  attachmentCount: number;
  targets: { name: string; className?: string }[];
  skipped: NoticeSkip[];
};
