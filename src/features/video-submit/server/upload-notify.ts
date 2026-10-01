import "server-only";
import { logActionAs } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import type { LinkVideoRoute } from "../route";

/** 감사로그의 "누가" — 로그인 없는 학부모 업로드라 사람 대신 문 이름(`logActionAs`). */
export const LINK_UPLOAD_ACTOR = "영상 제출 링크(학부모)";

/**
 * 제출 링크 업로드 완료 뒤(새 줄이 생겼을 때만) — 감사로그 + 담임 벨(기존 알림 표·`notifyUsers` 재사용).
 * best-effort: 둘 다 실패해도 업로드 결과는 그대로다(응답 뒤 `after()`에서 부른다).
 * 벨 수신 = 링크 반의 지금 담임 한 사람(담임이 없으면 벨 없음 — 학생 상세·제출 현황에는 그대로 잡힌다).
 */
export async function afterLinkUpload(input: { tenantId: string; studentId: string; route: LinkVideoRoute; videoId: string; bytes: number }): Promise<void> {
  const { tenantId, studentId, route } = input;
  const who = route.studentName?.trim() || "학생";
  const where = route.className?.trim() || "반 미정";
  await Promise.all([
    logActionAs({ tenantId, actorName: LINK_UPLOAD_ACTOR }, {
      action: "lesson_report_video_link_upload", targetType: "student", targetLabel: `${who} · ${where}`,
      metadata: { studentId, classId: route.classId, videoId: input.videoId, bytes: input.bytes, folder: route.folderName },
    }),
    route.teacherId
      ? notifyUsers([{
          tenantId, recipientId: route.teacherId, type: "homework_video_link",
          title: `${who} 학생 숙제 영상이 제출 링크로 올라왔습니다`, body: where,
          link: `/students/${studentId}?tab=homework-videos`,
        }])
      : Promise.resolve(),
  ]);
}
