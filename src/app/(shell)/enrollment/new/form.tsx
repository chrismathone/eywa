"use client";

import { ConsultationFullForm } from "../_components/consultation-full-form";
import type { RecordingOwner } from "@/lib/recording-recovery";

/** 신규 등록상담 — 전체 폼(학생/학부모/주소/상담내용/과목 점수 탭/학원관리/등록·결제). */
export function NewConsultationForm({ recordingOwner }: { recordingOwner: RecordingOwner }) {
  return <ConsultationFullForm mode="create" recordingOwner={recordingOwner} />;
}
