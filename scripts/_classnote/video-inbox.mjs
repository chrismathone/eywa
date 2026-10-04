import { videoCandidate } from "./video-download.mjs";
import { loadVideoTeacher } from "./video-teacher-route.mjs";
import { loadWorkerVideoDriveSetting } from "./video-drive-settings.mjs";

/** [영상] 표시는 attached_video에서 나온다. 문자열만 적은 글·댓글은 대상이 아니다. */
export function incomingVideo(item, centerId, parent = null) {
  const post = parent ? { ...item, id: parent.id, child: parent.child, cls: parent.cls, class_name: parent.class_name } : item;
  const candidate = videoCandidate(post, centerId, false, true);
  if (!candidate) return null;
  return { ...candidate, commentId: parent ? String(item.id) : null };
}

/** 워터마크/댓글 수를 갱신하기 전에 내구성 큐에 넣는다. 중복 호출은 같은 영상 1행으로 합쳐진다.
 *  enabled 를 넘기면 그 값을 쓴다(폴 시작에 읽은 설정). 없으면 그 자리에서 설정을 읽는다. env 폴더만 보고 켜지 않는다. */
export async function enqueueParentVideos(sql, tenant, centerId, items, parent = null, options = {}) {
  let enabled = options.enabled;
  if (typeof enabled !== "boolean") {
    const setting = await loadWorkerVideoDriveSetting(sql, tenant, options.env ? { env: options.env } : {});
    if (setting.error) throw new Error("영상 저장 폴더 설정을 확인하지 못했습니다.");
    enabled = setting.enabled === true;
  }
  if (!enabled) return 0;
  let added = 0;
  for (const item of items) {
    const candidate = incomingVideo(item, centerId, parent);
    if (!candidate) continue;
    const route = await loadVideoTeacher(sql, tenant, candidate);
    const rows = await sql`insert into student_homework_videos
      (tenant_id, student_id, subject, teacher_id, center_id, video_id, post_id, comment_id, posted_at, payload)
      values (${tenant}, ${route.studentId}, ${route.subject}, ${route.teacherId}, ${candidate.centerId}, ${candidate.videoId},
        ${candidate.postId}, ${candidate.commentId}, ${candidate.postedAt}, ${sql.json(candidate)})
      on conflict (tenant_id, center_id, video_id) do update set
        payload = case when student_homework_videos.status = 'uploaded' then '{}'::jsonb else excluded.payload end,
        updated_at = now()
      returning (xmax = 0) as inserted`;
    if (rows[0]?.inserted) added++;
  }
  return added;
}
