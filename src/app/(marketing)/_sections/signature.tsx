import { FLOW_NODES } from "@/data/marketing";
import { EyIcon } from "@/components/icons/eywa-icons";
import { CountUp } from "../_motion/count-up";
import { Reveal } from "../_motion/reveal";
import { EditorialPhoto } from "../_ui/photo";
import { Eyebrow } from "../_ui/eyebrow";
import { SectionShell } from "../_ui/section-shell";
import attendanceImg from "../_img/attendance-checkin.webp";

/** 다크 콘솔 위 액터 도트 — 라이트 팔레트보다 한 단계 밝은 변형 (파인 서피스 전용) */
const DOT: Record<string, string> = {
  rose: "#f27ca3",
  blue: "#7aa5f7",
  primary: "#4ade97",
  gold: "#e2b45f",
};

export function SignatureSection() {
  return (
    <SectionShell id="signature" pad="lg">
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <Reveal variant="up">
            <Eyebrow time="16:02" label="자동 연동" />
          </Reveal>
          <Reveal variant="clip" delay={60}>
            <h2 className="text-ink mt-4 text-[clamp(1.9rem,4vw,3.1rem)] leading-[1.16] font-extrabold tracking-[-0.035em]">
              출석 체크 한 번이면,
              <br />
              <span className="text-primary">네 곳이 자동으로.</span>
            </h2>
          </Reveal>
          <Reveal variant="up" delay={120}>
            <p className="text-text-dim mt-6 max-w-[32rem] text-[16px] leading-[1.75]">
              학생이 등원해 체크되는 순간 — 학부모 알림, 강사 출석부, 원장 화면, 수강료 차감이{" "}
              <span className="text-foreground font-semibold">0.4초</span> 만에 동시에. 원장님이 따로 입력할 일이 없습니다.
            </p>
          </Reveal>
        </div>
        <Reveal variant="up" delay={140}>
          <EditorialPhoto
            src={attendanceImg}
            alt="학원 리셉션 데스크에서 태블릿으로 출석을 체크하는 학생의 손"
            aspect="aspect-[4/3]"
            caption="등원 체크 · 16:02"
            sizes="(min-width: 1024px) 460px, 90vw"
          />
        </Reveal>
      </div>

      {/* 운영 콘솔 — 한 번의 등원이 네 곳으로 흐르는 로그 스트림 (시그니처) */}
      <Reveal variant="fade" delay={80} threshold={0.35} className="mt-14">
        <div className="ey-console border-[var(--pine-line)] relative overflow-hidden rounded-[20px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_44px_100px_-44px_rgba(11,16,13,0.55)]">
          {/* 콘솔 헤더 */}
          <div className="border-[var(--pine-line)] flex items-center justify-between border-b px-5 py-3 sm:px-7">
            <span className="text-[var(--pine-dim)] font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase">
              EYWA 운영 콘솔 — 자동 연동 로그
            </span>
            <span className="text-[var(--mint)] flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.1em]">
              <span className="ey-live bg-[var(--mint)] size-1.5 rounded-full" aria-hidden="true" />
              LIVE
            </span>
          </div>

          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            {/* 좌 — 로그 스트림 */}
            <div className="p-6 sm:p-8">
              {/* 트리거 */}
              <div className="ey-log flex items-baseline gap-3" style={{ transitionDelay: "60ms" }}>
                <span className="text-[var(--mint)] w-[52px] shrink-0 text-right font-mono text-[11px] font-bold">
                  16:02
                </span>
                <p className="text-[var(--pine-text)] text-[14px] font-bold">
                  강OO 학생이 등원했습니다
                  <span className="text-[var(--pine-dim)] ml-2 font-mono text-[11px] font-medium">check-in</span>
                </p>
              </div>

              {/* 스트림 */}
              <ul className="border-[var(--pine-line)] mt-4 ml-[58px] space-y-0 border-l pl-0">
                {FLOW_NODES.map((n, i) => (
                  <li
                    key={n.actor}
                    className="ey-log border-[var(--pine-line)] flex items-center gap-3 border-b py-3.5 pl-5 last:border-b-0 sm:gap-4"
                    style={{ transitionDelay: `${260 + i * 150}ms` }}
                  >
                    <span className="text-[var(--mint)] w-11 shrink-0 font-mono text-[11px] font-bold">{n.arrive}</span>
                    <span className="flex w-[64px] shrink-0 items-center gap-1.5">
                      <span className="size-1.5 rounded-full" style={{ background: DOT[n.color] }} aria-hidden="true" />
                      <span className="text-[var(--pine-text)] text-[12px] font-bold">{n.actor}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[var(--pine-text)] block truncate text-[13.5px] font-semibold">{n.title}</span>
                      <span className="text-[var(--pine-dim)] block truncate text-[11.5px]">{n.detail}</span>
                    </span>
                    <EyIcon name="check" size={14} className="text-[var(--mint)] shrink-0" />
                  </li>
                ))}
              </ul>
            </div>

            {/* 우 — 0.4초 (동시성을 숫자로 못박음) */}
            <div className="border-[var(--pine-line)] flex flex-col items-center justify-center border-t p-8 lg:border-t-0 lg:border-l">
              <p className="num text-[var(--pine-text)] text-[clamp(3.4rem,7vw,5.4rem)] leading-none font-extrabold tracking-[-0.045em]">
                <CountUp value={0.4} decimals={1} duration={1100} />
                <span className="text-[var(--mint)] ml-0.5 font-mono text-[0.42em] font-bold">s</span>
              </p>
              <p className="text-[var(--pine-dim)] mt-4 font-mono text-[11px] tracking-[0.14em] uppercase">
                4 events · 1 action · 0 입력
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}
