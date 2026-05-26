import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Announcement = {
  id: string;
  title: string;
  excerpt: string;
  author: string;
  postedAt: string;
  pinned?: boolean;
  audience: string;
};

const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "a1",
    title: "6월 정기시험 일정 안내",
    excerpt: "6월 17일(수) ~ 19일(금) 진행. 시간표는 각 반 담임이 학생에게 전달합니다.",
    author: "박원장",
    postedAt: "2시간 전",
    audience: "전체",
    pinned: true,
  },
  {
    id: "a2",
    title: "여름방학 시간표 변경 사전 공지",
    excerpt: "7월 21일부터 여름 특강 시간표로 전환. 강사진 회의는 6월 25일.",
    author: "이부장",
    postedAt: "어제",
    audience: "강사",
  },
  {
    id: "a3",
    title: "수강료 자동이체 신청 안내문 배포",
    excerpt: "신규 등록 학부모 대상 안내문 PDF가 자료실에 업로드되었습니다.",
    author: "최회계",
    postedAt: "2일 전",
    audience: "상담·회계",
  },
];

export function AnnouncementsCard() {
  return (
    <section className="bg-card border-border flex h-full flex-col rounded-lg border">
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">공지사항</h2>
          <p className="text-muted-foreground num mt-0.5 text-xs">최근 {ANNOUNCEMENTS.length}건</p>
        </div>
        <a
          href="#"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 transition hover:underline"
        >
          전체 보기 →
        </a>
      </header>

      <ul className="divide-border flex-1 divide-y">
        {ANNOUNCEMENTS.map((a) => (
          <li
            key={a.id}
            className="hover:bg-accent/40 group cursor-pointer px-5 py-4 transition-colors"
          >
            <div className="flex items-start gap-3">
              {a.pinned ? (
                <Pin className="text-chart-4 mt-1 size-3.5 shrink-0 -rotate-45 fill-current" />
              ) : (
                <span className="bg-muted-foreground/30 mt-2.5 size-1.5 shrink-0 rounded-full" />
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-medium leading-snug">{a.title}</h3>
                <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                  {a.excerpt}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[11px]">
                  <Badge
                    variant="secondary"
                    className="h-5 rounded-sm px-1.5 text-[10px] font-normal"
                  >
                    {a.audience}
                  </Badge>
                  <span className="text-muted-foreground">{a.author}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-muted-foreground num">{a.postedAt}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
