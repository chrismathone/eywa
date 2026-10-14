import { streamHomeworkVideo } from "@/features/students/server/homework-video-stream";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return streamHomeworkVideo(request, (await params).id);
}
