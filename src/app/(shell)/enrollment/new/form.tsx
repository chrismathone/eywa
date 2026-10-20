"use client";

import { ConsultationFullForm } from "../_components/consultation-full-form";
import type { RecordingOwner } from "@/lib/recording-recovery";

/** 신규 등록상담 — 전체 폼(학생/학부모/주소/상담내용/과목 점수 탭/학원관리/등록·결제). */
export function NewConsultationForm({ recordingOwner, referrerReady, counselor, instance }: {
  recordingOwner: RecordingOwner;
  referrerReady: boolean;
  /** 상담자 칸 기본값 = 이 상담을 추가하는 사람(원장 2026-10-19 — 고칠 수 있다). */
  counselor: string;
  instance?: { formId?: string };
}) {
  return <ConsultationFullForm mode="create" recordingOwner={recordingOwner} initial={{ referrerReady, counselor }} instance={instance} />;
}
