import { EyIcon } from "@/components/icons/eywa-icons";
import { Reveal } from "../_motion/reveal";
import { MockWorkspace } from "../_ui/mock-workspace";
import { SectionShell } from "../_ui/section-shell";

const POINTS: { icon: "branch" | "rings" | "wave"; title: string; desc: string }[] = [
  { icon: "branch", title: "메뉴를 창으로", desc: "12개 메뉴를 각각 창으로 띄워 나란히 봅니다." },
  { icon: "rings", title: "끌어서 스냅·타일", desc: "창을 가장자리에 대면 자동으로 타일 정렬." },
  { icon: "wave", title: "배경으로 보내기", desc: "쓰던 화면은 배경으로, 진짜 멀티태스킹." },
];

export function WorkspaceSection() {
  return (
    <SectionShell id="workspace" pad="lg">
      <div className="mx-auto max-w-[46rem] text-center">
        <Reveal variant="up">
          <p className="text-gold font-mono text-[11px] font-bold tracking-[0.16em] uppercase">
            워크스페이스 · 우리만의 차별점
          </p>
        </Reveal>
        <Reveal variant="clip" delay={60}>
          <h2 className="text-foreground mt-5 text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.16] font-extrabold tracking-[-0.025em]">
            필요한 화면을, <span className="text-primary">한 책상 위에.</span>
          </h2>
        </Reveal>
        <Reveal variant="up" delay={140}>
          <p className="text-text-dim mx-auto mt-6 max-w-[34rem] text-[16px] leading-[1.8]">
            시간표를 띄운 채 출석부를 열고, 학생 상세를 옆에 붙입니다. 창을 끌어 옮기고, 가장자리에 대면 자동으로
            타일처럼 정렬돼요. 데스크톱처럼, 태블릿처럼 — <span className="text-foreground font-semibold">다른 학원 프로그램엔 없는 방식</span>입니다.
          </p>
        </Reveal>
      </div>

      <Reveal variant="up" delay={160} className="mx-auto mt-12 max-w-[1000px]">
        <MockWorkspace />
      </Reveal>

      <Reveal variant="up" delay={120} className="mx-auto mt-10 grid max-w-[860px] gap-5 sm:grid-cols-3">
        {POINTS.map((p) => (
          <div key={p.title} className="flex items-start gap-3">
            <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <EyIcon name={p.icon} size={17} />
            </span>
            <div>
              <p className="text-foreground text-[14px] font-bold">{p.title}</p>
              <p className="text-text-dim mt-0.5 text-[12.5px] leading-relaxed">{p.desc}</p>
            </div>
          </div>
        ))}
      </Reveal>
    </SectionShell>
  );
}
