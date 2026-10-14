"use client";

import { HomeworkVideoNative } from "./homework-video-native";

/** All homework video surfaces pass the stored video id; thumbnails are decoration, never an access verdict. */
export function HomeworkVideoPlayer(props: {
  preview: string; thumbnail: string; title: string; uploadedAt: string | null; videoId?: string; messageId?: string;
}) {
  const { videoId, messageId } = props;
  if (videoId) {
    const src = `/api/homework-videos/${encodeURIComponent(videoId)}/stream${messageId ? `?messageId=${encodeURIComponent(messageId)}` : ""}`;
    return <HomeworkVideoNative key={src} src={src} preview={props.preview} title={props.title} />;
  }
  // Compatibility for an old caller without an archive row id. Google performs its own access check.
  return <div className="border-line relative aspect-video w-full overflow-hidden rounded-xl border">
    <iframe src={props.preview} title={props.title} allow="autoplay; fullscreen" allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 size-full" />
  </div>;
}
