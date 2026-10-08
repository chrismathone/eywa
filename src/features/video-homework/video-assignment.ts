export type AssignableVideo = {
  id: string; postedAt: string; className: string | null; homeworkDate: string | null; source: string;
  postId: number | null; revision: number; excluded: boolean;
  playback: { preview: string; thumbnail: string; uploadedAt: string | null } | null;
};
export type VideoAssignmentOptions = { ok: true; videos: AssignableVideo[]; dates: string[] } | { ok: false; error: string };
