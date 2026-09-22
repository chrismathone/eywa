"use client";

import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { issueDocumentUploadTicket, registerUploadedDocument } from "./server/actions";
import { splitFileName } from "./file-name";

export async function uploadDocumentFile(file: File, category: string, onProgress?: (progress: number) => void) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("빈 파일이거나 크기가 20MB를 초과합니다.");
  const contentType = file.type || "application/octet-stream";
  const request = new FormData();
  request.set("ext", splitFileName(file.name).extension.slice(1).toLowerCase() || "bin");
  request.set("contentType", contentType); request.set("size", String(file.size));
  const issued = await issueDocumentUploadTicket(undefined, request);
  if (!issued?.ticket) throw new Error(issued?.error ?? "업로드 준비 실패");
  await uploadToTicket(issued.ticket, file, onProgress);
  const data = new FormData();
  data.set("path", issued.ticket.path); data.set("title", file.name); data.set("fileName", file.name);
  data.set("category", category); data.set("size", String(file.size)); data.set("contentType", contentType);
  const registered = await registerUploadedDocument(undefined, data);
  if (!registered?.ok) throw new Error(registered?.error ?? "업로드 등록 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.");
}
