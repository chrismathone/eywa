/**
 * **화면 이용 시간 계측기** — 한 문서(창 하나·배경 하나)가 어느 화면에 얼마나 머물렀는지를 센다. 순수 로직이다
 * (브라우저 API 없음 → Vitest). 이벤트 배선은 [`session.ts`](./session.ts)가 한다.
 *
 * 두 시간을 **함께** 센다(원장 2026-09-28 *"가만히 멍때리고 있는 경우도 있을 수 있기에 실제 활동하는 시간을
 * 카운트하는게 가장 중요할듯. 아니면 동시에 더블체크해도 되고"*):
 *  - **화면 시간(open)** = 화면이 보이고(최소화·가려진 창·숨은 탭 제외) 그 화면을 잡고 있던 시간
 *    (포커스가 그 문서에 있거나 활동 중). 띄워 두고 멍하니 있는 시간도 들어간다.
 *  - **활동 시간(active)** = 그중 마지막 입력(클릭·키·휠·터치·마우스 움직임)에서 `IDLE_MS` 안쪽인 시간.
 *    🔴 활동 ⊆ 화면 — 활동 시간이 화면 시간을 넘는 일은 없다(서버도 한 번 더 자른다).
 *
 * 🔑 구간은 **시작 때의 상태**로 센다 — 상태가 바뀌는 순간(숨김·포커스·쉬다가 돌아온 첫 입력)마다 `sample`을 불러
 *    구간을 끊으므로, 5초 틱 사이에 바뀐 상태도 경계가 정확하다.
 * ⚠️ 틱 사이가 `MAX_GAP_MS`보다 길면(노트북 절전·백그라운드 타이머 지연) 그만큼만 센다 — 깨어나자마자
 *    잠든 시간 전체가 한 화면에 몰리지 않게.
 */

/** 입력이 이만큼 없으면 활동이 멈춘다(화면 시간은 포커스가 있는 한 계속 센다). */
export const IDLE_MS = 60_000;
/** 상태를 표본으로 뜨는 간격. */
export const TICK_MS = 5_000;
/** 모아 둔 시간을 서버로 보내는 간격(숨김·페이지 이탈 때는 즉시). 비콘 1번 = 서버 호출 1번이라 넉넉히 둔다. */
export const FLUSH_MS = 10 * 60_000;
/** 틱 한 번이 셀 수 있는 최대 구간. */
export const MAX_GAP_MS = 15_000;
/** 포커스 없는 창 위에서 마우스가 이만큼 머물며 움직여야 활동으로 친다(지나가며 스친 창은 안 센다). */
export const HOVER_DWELL_MS = 1_500;

export const USAGE_ENDPOINT = "/api/usage";
export const MAX_ITEMS_PER_BEACON = 40;

export type FrameState = { visible: boolean; focused: boolean };
export type UsageItem = { route: string; visits: number; openSec: number; activeSec: number };
type Bucket = { visits: number; openMs: number; activeMs: number };

export class UsageMeter {
  private route: string | null = null;
  /** 지금 화면을 이번 방문으로 이미 셌는가 — 처음 화면 시간이 쌓이는 순간 1회 센다. */
  private counted = false;
  private state: FrameState = { visible: false, focused: false };
  private readonly buckets = new Map<string, Bucket>();

  constructor(private lastAt: number) {}

  /** [직전 표본, now] 구간을 적립하고 상태를 갈아 끼운다. */
  sample(now: number, lastInputAt: number, next: FrameState): void {
    this.accrue(now, lastInputAt);
    this.state = next;
  }

  /** 화면 이동 — 직전 화면까지 적립한 뒤 새 화면으로. 같은 화면이면 방문을 새로 세지 않는다. */
  navigate(now: number, lastInputAt: number, route: string, next: FrameState): void {
    this.accrue(now, lastInputAt);
    if (route !== this.route) {
      this.route = route;
      this.counted = false;
    }
    this.state = next;
  }

  /**
   * 보낼 만큼(초 단위) 꺼낸다. 1초 미만 나머지는 다음 번으로 넘긴다.
   * 활동 초는 화면 초를 넘지 않게 자르고, 잘린 만큼도 다음 번으로 넘긴다.
   */
  drain(): UsageItem[] {
    const out: UsageItem[] = [];
    for (const [route, b] of this.buckets) {
      const openSec = Math.floor(b.openMs / 1000);
      const activeSec = Math.min(Math.floor(b.activeMs / 1000), openSec);
      if (b.visits > 0 || openSec > 0) {
        out.push({ route, visits: b.visits, openSec, activeSec });
        b.visits = 0;
        b.openMs -= openSec * 1000;
        b.activeMs -= activeSec * 1000;
      }
      // 떠난 화면의 1초 미만 부스러기는 버린다 — 방문한 화면 수만큼 메모리가 자라지 않게.
      if (route !== this.route && b.visits === 0 && b.openMs < 1000) this.buckets.delete(route);
    }
    return out;
  }

  private accrue(now: number, lastInputAt: number): void {
    const elapsed = now - this.lastAt;
    this.lastAt = now;
    if (!this.route || elapsed <= 0 || !this.state.visible) return;
    const dt = Math.min(elapsed, MAX_GAP_MS);
    const from = now - dt;
    const activeMs = Math.max(0, Math.min(now, lastInputAt + IDLE_MS) - from);
    if (activeMs <= 0 && !this.state.focused) return;
    let b = this.buckets.get(this.route);
    if (!b) {
      b = { visits: 0, openMs: 0, activeMs: 0 };
      this.buckets.set(this.route, b);
    }
    b.openMs += dt;
    b.activeMs += activeMs;
    if (!this.counted) {
      b.visits += 1;
      this.counted = true;
    }
  }
}
