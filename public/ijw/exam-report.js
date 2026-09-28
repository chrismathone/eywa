/* 인재원 시험 결과지 (2026-08-31 사용자 요청 "학부모에게 전달할 수 있을 정도로")
 *
 * ⚠️ **EYWA(aywa)가 이 파일을 그대로 복사해 쓴다** (2026-09-28 원장 결정 — 영어 수업보고서의 결과지를 인재원 결과지 그대로).
 *   EYWA는 pull API 3번·5번(src/eval.ts buildExamSheet, docs/EYWA-API.md)의 items·rank·평균을 render(data)에 넣어 그린다.
 *   → **여기 모양(그리는 법·data 모양·SECTIONS)을 바꾸면 EYWA 세션(cowrie/aywa)에 알려 같이 옮길 것.**
 *   (2026-09-15에는 "EYWA는 이 파일을 쓰지 않는다"였다 — 이제 사실이 아니다.)
 *
 * ⚠️ 왜 캔버스로 그리는가 — 화면·JPG·PDF가 **한 글자도 다르지 않게** 하기 위해서다.
 *    HTML로 그리고 이미지를 따로 만들면 둘이 어긋난다(줄바꿈·글꼴·여백). 학부모에게 나가는
 *    문서라 "관리자가 본 것"과 "학부모가 받은 것"이 달라서는 안 된다.
 *    그래서 그리는 곳은 여기 한 군데뿐이고, 미리보기·JPG·PDF가 모두 이 캔버스에서 나온다.
 *
 * ⚠️ **분석 부분은 A4 한 장** (2026-09-15 사용자 결정 "매우 요약해서 한 장, 200문항 기준").
 *    칸마다 높이를 정해 두고 그 안에만 그린다. 머리말·학생·점수·요약 칸은 고정, 분석 도표는 카드 높이 고정,
 *    문항별 O/X 격자는 남은 자리 안에서 칸을 줄인다. 긴 글은 한 줄에서 "…"로 자른다.
 *
 * ⚠️ **다시 봐야 할 문항만 장을 넘긴다** (2026-09-16 사용자 요청 "몇 개 말고 다 나와야 함 — 두 장 돼도 됨").
 *    옛 규칙은 남은 자리만큼만 싣고 "외 N문항"으로 끊는 것이었다. 지금은 틀린 문항을 전부 싣고,
 *    자리가 모자라면 캔버스를 PAGE_H 배수로 늘려 얇은 머리말·쪽 번호를 붙인다 (높이 = PAGE_H × pages).
 *    ⚠️ 캔버스를 한 장짜리 이미지로 바꾸는 곳은 **반드시 slice()를 거쳐야 한다** — 그냥 toDataURL 하면
 *    두 장짜리 긴 그림이 A4 한 장에 눌려 박힌다(반 전체 뽑기가 여기에 걸린다).
 *
 * 여러 버전 (2026-09-15 2차 사용자 요청 "객관식·주관식, 도표·도형으로 분석하는 버전, 체크해서 골라 보기"):
 *    render(data, { sections: [...] }) — 점수 칸은 늘 나오고, 나머지 칸은 SECTIONS 중 고른 것만 그린다.
 *    PRESETS(요약형·분석형·오답 중심)는 자주 쓰는 조합일 뿐이다. 관리자 화면이 이 두 목록으로 체크 칸을 만든다.
 *    ⚠️ 꼬리말·안내 문구("자동으로 만들어졌습니다" 등)는 넣지 않는다 (2026-09-15 사용자 요청). 학부모가 받는 문서다.
 *
 * 쓰는 법:
 *   const rep = await IjwExamReport.render(data, { sections: ["grid", "wrong"] }); // { canvas, width, height, pages } — pages는 1 이상
 *   IjwExamReport.saveJpeg(rep.canvas, "파일명");
 *   IjwExamReport.print(rep.canvas, "제목");        // 브라우저 인쇄 → "PDF로 저장"
 *   data.items[i] = { prompt, answer, typed, correct, choice?, answered?, ms? }
 *     choice(true=객관식/false=주관식)·answered·ms(문항별 걸린 시간)가 있으면 그만큼 분석이 늘어난다.
 */
(function () {
  "use strict";

  // A4 200dpi — 학원에서 인쇄해도, 폰으로 보내도 글자가 깨지지 않는 최소선
  const W = 1654;
  const PAGE_H = Math.round(W * 297 / 210); // 2339
  const M = 96;                             // 바깥 여백
  const CW = W - M * 2;                     // 본문 폭 1462
  const FOOT_RESERVE = 132;                 // 쪽 아래 여백 (평가분석지도 같은 값을 쓴다)
  const CONT_H = 128;                       // (여러 장이던 시절 둘째 장 머리말 높이 — 평가분석지 호환용으로 내보내기만 남김)

  const FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
  // 2026-09-16 코덱스 디자인 검토로 한 단계 낮춘 팔레트 — 앞의 값은 화면(Tailwind 계열)에서는 선명했지만
  // 학부모에게 나가는 인쇄물에서는 들뜨고, 흑백 복사에서 대비가 불안정했다.
  const C = {
    ink: "#29273a", ink2: "#646176", muted: "#858297", line: "#e4e1ee",
    primary: "#5b51c9", primaryDeep: "#4840ac", primarySoft: "#f0eefa",
    good: "#14825f", goodDeep: "#0e684c", goodSoft: "#eaf5f0",
    bad: "#c9425a", badDeep: "#a9364b", badSoft: "#fbecef",
    warn: "#b8801a", warnDeep: "#8a5a10", warnSoft: "#f7eed6",
    gray: "#b2b0c2",
    surf: "#fcfbfe", white: "#ffffff",
    zebra: "#faf9fc",   // 표의 얼룩줄 — 카드 면(surf)보다 한 톤 아래
  };

  // ── 그리기 도우미 ────────────────────────────────────────────────────────
  const font = (size, weight) => `${weight} ${size}px ${FONT}`;

  function rrect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    // 오래된 엔진 대비 — exe 셸(WebView2)은 roundRect를 지원하지만 안전하게 남겨 둔다
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  const fillR = (ctx, x, y, w, h, r, color) => { rrect(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill(); };
  const strokeR = (ctx, x, y, w, h, r, color, lw) => {
    rrect(ctx, x, y, w, h, r); ctx.strokeStyle = color; ctx.lineWidth = lw || 2; ctx.stroke();
  };

  function txt(ctx, str, x, y, o) {
    const s = o || {};
    ctx.font = font(s.size || 28, s.weight || 600);
    ctx.fillStyle = s.color || C.ink;
    ctx.textAlign = s.align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(str == null ? "" : str), x, y);
  }
  const widthOf = (ctx, str, size, weight) => {
    ctx.font = font(size, weight);
    return ctx.measureText(String(str == null ? "" : str)).width;
  };

  /** 폭에 맞춰 줄을 나눈다 — 낱말 사이에서 먼저 끊고, 한 낱말이 폭을 넘으면 글자 단위로 자른다 */
  function wrap(ctx, str, maxW, size, weight) {
    ctx.font = font(size, weight);
    const out = [];
    for (const para of String(str == null ? "" : str).split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        if (ctx.measureText(line + word).width <= maxW) { line += word; continue; }
        if (line.trim()) { out.push(line.trimEnd()); line = ""; }
        let chunk = word;
        while (ctx.measureText(chunk).width > maxW && chunk.length > 1) {
          let cut = chunk.length;
          while (cut > 1 && ctx.measureText(chunk.slice(0, cut)).width > maxW) cut--;
          out.push(chunk.slice(0, cut));
          chunk = chunk.slice(cut);
        }
        line = chunk;
      }
      out.push(line.trimEnd());
    }
    return out.length ? out : [""];
  }

  /** 한 줄 폭을 넘으면 뒤를 잘라 "…"를 붙인다 — 한 장에 담으려면 줄을 늘리지 않고 끊어야 한다 */
  function fit(ctx, str, maxW, size, weight) {
    ctx.font = font(size, weight);
    const s = String(str == null ? "" : str).replace(/\s+/g, " ").trim();
    if (maxW <= 0) return "";
    if (ctx.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
    }
    return s.slice(0, lo).trimEnd() + "…";
  }

  const fmtDate = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fmtDur = (ms) => {
    if (!Number.isFinite(ms) || ms < 0) return "-";
    if (ms < 1000) return "1초 미만";
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
  };
  /** 문항당 초 — 짧은 시간은 소수 한 자리까지 (객관식 평균 3.4초 같은 값이 흔하다) */
  const fmtSec = (sec) => {
    if (sec == null || !Number.isFinite(sec)) return "-";
    if (sec < 10) return `${sec.toFixed(1)}초`;
    if (sec < 60) return `${Math.round(sec)}초`;
    return `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초`;
  };
  const scoreColor = (pct) => (pct >= 80 ? C.good : pct >= 60 ? C.primary : C.bad);

  /** 로고 — data: URI만 들어 있는 SVG라 캔버스를 오염시키지 않는다(toDataURL 가능) */
  function loadLogo() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // 못 불러와도 결과지는 나와야 한다
      img.src = "/ijw/logo.svg?v=4"; // aywa: 인재원 로고를 /ijw 아래에 둔다(이 줄만 원본과 다르다)
    });
  }

  // ── 분석 도우미 ──────────────────────────────────────────────────────────
  // 영어인 쪽(문제·정답 중 알파벳이 많은 쪽)의 낱말 수로 단어·숙어·문장을 가른다.
  // 객관식은 보통 영어가 문제에, 주관식은 정답에 있어 어느 한쪽으로 고정하면 절반이 틀리게 분류된다.
  const latinCount = (s) => (String(s || "").match(/[A-Za-z]/g) || []).length;
  function kindOf(it) {
    const p = String(it.prompt || ""), a = String(it.answer || "");
    const en = latinCount(a) >= latinCount(p) ? a : p;
    if (!latinCount(en)) return null;
    const words = en.replace(/[^A-Za-z'’\- ]+/g, " ").trim().split(/\s+/).filter(Boolean).length;
    return words <= 1 ? "단어" : words <= 3 ? "숙어·구" : "문장";
  }
  const normAns = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9가-힣' ]+/g, "").replace(/\s+/g, " ").trim();
  function editDistance(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  /** 틀린 이유 — 비워 둠 / 철자 실수(주관식에서 한두 글자 차이) / 다른 답.
   *  "알긴 아는데 철자를 틀린 것"과 "모르는 것"을 나눠 보여 주는 게 학부모 상담에서 가장 쓸모 있다 */
  function causeOf(it) {
    const typed = normAns(it.typed);
    if (it.answered === false || !typed) return "blank";
    if (it.choice === false) {
      const ans = normAns(it.answer);
      const dist = editDistance(typed, ans);
      if (dist > 0 && dist <= Math.max(1, Math.floor(ans.length * 0.2))) return "typo";
    }
    return "other";
  }

  // ── 고를 수 있는 칸 · 자주 쓰는 조합 ──────────────────────────────────────
  const SECTIONS = [
    { key: "rank", label: "등수" },
    { key: "grid", label: "문항별 결과" },
    { key: "radar", label: "영역별 그래프" },
    { key: "causes", label: "오답 입력 유형" },
    { key: "blocks", label: "구간별 정답률" },
    { key: "time", label: "풀이 시간" },
    { key: "wrong", label: "다시 봐야 할 문항" },
  ];
  const PRESETS = [
    { key: "summary", label: "요약형", sections: ["rank", "grid", "wrong"] },
    { key: "analysis", label: "분석형", sections: ["rank", "radar", "causes", "blocks", "wrong"] },
    { key: "wrongs", label: "오답 중심", sections: ["wrong"] },
  ];

  // ── 등수 (2026-09-16 사용자 요청) ──
  //  처음엔 리본 달린 메달을 그렸는데 사용자가 "조잡하다, 마크 말고 등수만"이라고 했고,
  //  코덱스 검토도 같은 지적을 했다("학부모용 성적표가 게임 화면처럼 보인다 — 중요한 건 장식이 아니라
  //  비교 집단과 분모다"). 그래서 장식 없이 숫자와 분모만 오른쪽 위에 둔다.
  //  ⚠️ 점수 칸 **안**의 빈 자리에 그린다 — 칸을 따로 만들면 켤 때마다 아래가 밀려 한 장을 넘긴다.
  //     켜고 끄는 것이 높이를 바꾸지 않아야 "무엇을 골라도 A4 한 장"이 유지된다.
  /** 점수 칸 오른쪽 위, 오른쪽 맞춤 두 줄. rank가 없으면(미채점·순위 밖) 아무것도 그리지 않는다 */
  function drawRankMark(ctx, rank, rx, y) {
    if (!rank || !Number.isFinite(rank.rank)) return;
    txt(ctx, "전체 등수", rx, y + 34, { size: 18, weight: 600, color: C.muted, align: "right" });
    // 분모("/ 26명")를 먼저 재서 오른쪽에 붙이고, 큰 숫자를 그 왼쪽에 둔다 — 자릿수가 늘어도 안 밀린다
    const sub = Number.isFinite(rank.total) ? ` / ${rank.total}명` : "";
    const subW = sub ? widthOf(ctx, sub, 22, 800) : 0;
    if (sub) txt(ctx, sub, rx, y + 84, { size: 22, weight: 800, color: C.muted, align: "right" });
    txt(ctx, `${rank.rank}위`, rx - subW, y + 84, { size: 42, weight: 900, color: C.ink, align: "right" });
    if (Number.isFinite(rank.classRank)) {
      const cls = `반 ${rank.classRank}위${Number.isFinite(rank.classTotal) ? ` · ${rank.classTotal}명 중` : ""}`;
      txt(ctx, cls, rx, y + 120, { size: 21, weight: 800, color: C.primaryDeep, align: "right" });
    }
  }

  // ── 결과지 (한 장) ───────────────────────────────────────────────────────
  const GRID_MAX_H = 560;                          // 문항별 격자 높이 상한 — 200문항이 20칸 × 10줄로 들어가는 크기
  const BODY_BOTTOM = PAGE_H - FOOT_RESERVE - 24;  // 본문이 내려올 수 있는 끝
  // 분석 카드 높이 — 반쪽(두 개가 한 줄) / 한 줄 전체
  const CARD_H = { radar: 400, causes: 400, time: 400, blocks: 260 };
  const FULL_H = { radar: 400, causes: 320, time: 320, blocks: 260 };

  async function render(data, opts) {
    const d = data || {};
    const o = opts || {};
    const want = new Set(Array.isArray(o.sections) ? o.sections : PRESETS[0].sections);
    const items = Array.isArray(d.items) ? d.items : [];
    const total = Number.isFinite(d.total) ? d.total : items.length;
    const correct = Number.isFinite(d.correct) ? d.correct : items.filter((x) => x && x.correct === true).length;
    const pct = Number.isFinite(d.pct) ? d.pct : (total ? Math.round(correct / total * 100) : 0);
    const wrongN = Math.max(0, total - correct);
    const wrongAll = items.map((it, i) => ({ it, no: i + 1 })).filter((x) => x.it && x.it.correct === false);
    const who = d.studentName || d.userId || "학생";
    const deckName = d.deckName || "시험";
    const issuedAt = fmtDate(new Date().toISOString());

    const okOf = (list) => list.filter((x) => x && x.correct === true).length;
    const pctOf = (ok, n) => (n ? Math.round(ok / n * 100) : 0);
    // 객관식·주관식 나눠 보기 — 두 종류가 다 있을 때만 (choice 값을 안 주는 호출은 합계만 보인다)
    const choiceItems = items.filter((x) => x && x.choice === true);
    const typedItems = items.filter((x) => x && x.choice === false);
    const hasType = choiceItems.length > 0 && typedItems.length > 0;
    // 객관식이 앞에 몰려 있으면(2026-09-15부터 출제 순서) 경계 번호 — 격자 제목·구간 막대가 함께 쓴다
    let typeSplit = null;
    if (hasType) {
      const noOf = (flag) => items.map((x, i) => (x && x.choice === flag ? i + 1 : 0)).filter(Boolean);
      const a = noOf(true), b = noOf(false);
      const solid = (arr) => arr[arr.length - 1] - arr[0] + 1 === arr.length;
      if (solid(a) && solid(b)) {
        const first = a[0] < b[0] ? { label: "객관식", r: a } : { label: "주관식", r: b };
        const second = a[0] < b[0] ? { label: "주관식", r: b } : { label: "객관식", r: a };
        typeSplit = { first, second, at: first.r[first.r.length - 1] };
      }
    }

    // 글꼴이 준비되기 전에 그리면 대체 글꼴로 그려져 자간이 어긋난다
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* 무시 */ } }
    const logo = await loadLogo();

    // 다시 봐야 할 문항이 넘치면 아래에서 더 긴 캔버스로 갈아탄다 — 그래서 const가 아니다.
    // (아래 도우미들은 ctx 이름을 그대로 부르므로 갈아끼우면 새 ctx에 그려진다)
    let canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = PAGE_H;
    let ctx = canvas.getContext("2d");
    ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, PAGE_H);

    const section = (y, title, sub) => {
      ctx.fillStyle = C.primary; ctx.fillRect(M, y + 6, 6, 24);
      txt(ctx, title, M + 22, y + 30, { size: 28, weight: 900, color: C.ink });
      if (sub) txt(ctx, sub, W - M, y + 29, { size: 20, weight: 700, color: C.muted, align: "right" });
      return y + 50;
    };
    const card = (x, y, w, h, title, sub) => {
      fillR(ctx, x, y, w, h, 16, C.surf);
      strokeR(ctx, x, y, w, h, 16, C.line, 1.5);
      txt(ctx, title, x + 26, y + 46, { size: 24, weight: 900, color: C.ink });
      if (sub) txt(ctx, sub, x + w - 26, y + 45, { size: 18, weight: 600, color: C.muted, align: "right" });
    };
    /** 가로 막대 여러 줄 — 영역이 셋 미만이라 도형을 못 그릴 때·풀이 시간에 쓴다 */
    const hbars = (x, y, w, rows, fmt, max) => {
      const LBW = 150, BX = x + LBW, BW = w - LBW - 120;
      rows.forEach((r, i) => {
        const by = y + i * 52;
        txt(ctx, r.label, x, by + 19, { size: 20, weight: 800, color: C.ink2 });
        fillR(ctx, BX, by, BW, 22, 11, "#eceafb");
        if (r.v != null) fillR(ctx, BX, by, Math.max(6, Math.round(BW * Math.min(1, r.v / (max || 1)))), 22, 11, r.color);
        txt(ctx, fmt(r.v), BX + BW + 14, by + 20, { size: 20, weight: 800, color: C.ink });
      });
    };

    // ① 머리말
    ctx.fillStyle = C.primarySoft; ctx.fillRect(0, 0, W, 4);
    let lx = M;
    if (logo) {
      const lh = 84, lw = logo.width && logo.height ? Math.round(lh * logo.width / logo.height) : 60;
      ctx.drawImage(logo, M, 28, lw, lh);
      lx = M + lw + 22;
    }
    txt(ctx, "인재원", lx, 80, { size: 40, weight: 900, color: C.ink });
    txt(ctx, "INJAEWON  ·  영어 학습 시스템", lx, 110, { size: 18, weight: 600, color: C.muted });
    txt(ctx, "시험 결과지", W - M, 78, { size: 30, weight: 800, color: C.primaryDeep, align: "right" });
    txt(ctx, `결과 발행 ${issuedAt}`, W - M, 110, { size: 18, weight: 600, color: C.muted, align: "right" });
    // 180×6 밑줄은 "선택된 탭"처럼 보였다 — 80×4 브랜드 선으로 줄인다 (코덱스 검토)
    ctx.fillStyle = C.line; ctx.fillRect(M, 138, CW, 1.5);
    ctx.fillStyle = C.primary; ctx.fillRect(M, 136, 80, 4);

    // ② 학생 · 시험
    let y = 150;
    const nameStr = fit(ctx, who, CW * 0.6, 50, 900);
    txt(ctx, nameStr, M, y + 58, { size: 50, weight: 900, color: C.ink });
    const nameW = widthOf(ctx, nameStr, 50, 900);
    txt(ctx, fit(ctx, d.className || "반 미배정", CW - nameW - 24, 24, 700), M + nameW + 20, y + 56,
      { size: 24, weight: 700, color: C.muted });
    const info = `응시 ${fmtDate(d.submittedAt)}`;
    const infoW = widthOf(ctx, info, 22, 600);
    txt(ctx, fit(ctx, deckName, CW - infoW - 36, 28, 800), M, y + 104, { size: 28, weight: 800, color: C.primaryDeep });
    txt(ctx, info, W - M, y + 104, { size: 22, weight: 600, color: C.ink2, align: "right" });
    y += 132;

    // ③ 점수 — 도넛 + 맞은 문항 + 평균 비교 (어느 버전이든 늘 나온다)
    const PH = 290;
    fillR(ctx, M, y, CW, PH, 18, C.surf);
    strokeR(ctx, M, y, CW, PH, 18, C.line, 1.5);
    {
      const cx = M + 170, cy = y + PH / 2, R = 100, LW = 28;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "#e7e3fb"; ctx.lineWidth = LW; ctx.stroke();
      if (pct > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, pct / 100));
        ctx.strokeStyle = scoreColor(pct); ctx.lineWidth = LW; ctx.stroke();
      }
      ctx.lineCap = "butt";
      txt(ctx, `${pct}%`, cx, cy + 15, { size: 56, weight: 900, color: C.ink, align: "center" });
      txt(ctx, "정답률", cx, cy + 52, { size: 20, weight: 600, color: C.muted, align: "center" });

      const rx = M + 340;
      txt(ctx, "맞은 문항", rx, y + 62, { size: 22, weight: 600, color: C.muted });
      txt(ctx, String(correct), rx, y + 140, { size: 74, weight: 900, color: C.primaryDeep });
      txt(ctx, `/ ${total}문항`, rx + widthOf(ctx, String(correct), 74, 900) + 14, y + 140,
        { size: 28, weight: 800, color: C.muted });

      // 등수 — 평균 막대 위, 맞은 문항 오른쪽의 빈 자리 (켜고 꺼도 칸 높이는 그대로다)
      if (want.has("rank")) drawRankMark(ctx, d.rank, M + CW - 40, y + 18);

      // 평균 비교 — 학부모가 가장 먼저 묻는 "우리 아이가 어느 정도인가"에 답한다.
      // 막대 오른쪽 80px는 % 글자 자리로 비워 둔다(안 그러면 숫자가 종이 밖으로 나간다)
      // 인원을 함께 적는다 (2026-09-16 코덱스 검토) — 학부모가 "전체"가 학원 전체인지
      // 이 시험 응시자인지 가장 먼저 묻는다. 모르면 그냥 "반 평균"으로 둔다
      const who4 = (n) => (Number.isFinite(n) && n > 0 ? ` · ${n}명` : "");
      const bars = [
        { label: "이 학생", v: pct, color: scoreColor(pct), bold: true },
        { label: `반 평균${who4(d.classCount)}`, v: d.classAvg, color: C.primary },
        { label: `응시자 평균${who4(d.allCount)}`, v: d.allAvg, color: C.muted },
      ].filter((b) => Number.isFinite(b.v));
      const BX = rx + 210, BW = (M + CW - 40) - BX - 80; // 라벨에 인원이 붙어 길어졌다
      let by = y + 176;
      for (const b of bars) {
        txt(ctx, b.label, rx, by + 17, { size: 20, weight: b.bold ? 800 : 600, color: b.bold ? C.ink : C.muted });
        fillR(ctx, BX, by, BW, 20, 10, "#eceafb");
        fillR(ctx, BX, by, Math.max(6, Math.round(BW * Math.min(100, Math.max(0, b.v)) / 100)), 20, 10, b.color);
        txt(ctx, `${Math.round(b.v)}%`, BX + BW + 14, by + 18,
          { size: 20, weight: 800, color: b.bold ? C.ink : C.muted });
        by += 34;
      }
    }
    y += PH + 24;

    // ④ 요약 칸 — 맞은 수·정답률은 위 점수 칸에 있으니 겹치지 않는 것만
    const tiles = [{ k: "틀린 문항", v: `${wrongN}개`, color: C.badDeep, bg: C.badSoft }];
    if (hasType) {
      const okC = okOf(choiceItems), okT = okOf(typedItems);
      tiles.push(
        { k: `객관식 · ${pctOf(okC, choiceItems.length)}%`, v: `${okC}/${choiceItems.length}`, color: C.primaryDeep, bg: C.primarySoft },
        { k: `주관식 · ${pctOf(okT, typedItems.length)}%`, v: `${okT}/${typedItems.length}`, color: C.primaryDeep, bg: C.primarySoft },
      );
    }
    tiles.push({ k: "걸린 시간", v: fmtDur(d.elapsedMs), color: C.ink2, bg: C.surf });
    if (!hasType) tiles.push({ k: "문항당 평균", v: fmtDur(total ? (d.elapsedMs || 0) / total : 0), color: C.ink2, bg: C.surf });
    {
      const TH = 104, G = 18, SW = (CW - G * (tiles.length - 1)) / tiles.length;
      tiles.forEach((s, i) => {
        const x = M + i * (SW + G);
        fillR(ctx, x, y, SW, TH, 12, s.bg); // 타일은 테두리 없이 면색만 (코덱스 검토)
        txt(ctx, fit(ctx, s.v, SW - 24, 32, 900), x + SW / 2, y + 56, { size: 32, weight: 900, color: s.color, align: "center" });
        txt(ctx, s.k, x + SW / 2, y + 88, { size: 20, weight: 600, color: C.muted, align: "center" });
      });
      y += TH + 34;
    }

    // ⑤ 분석 도표 — 고른 카드만. 반쪽 카드 둘은 한 줄에, 짝이 없으면 한 줄을 다 쓴다
    const axes = [
      { label: "객관식", list: choiceItems },
      { label: "주관식", list: typedItems },
      { label: "단어", list: items.filter((it) => it && kindOf(it) === "단어") },
      { label: "숙어·구", list: items.filter((it) => it && kindOf(it) === "숙어·구") },
      { label: "문장", list: items.filter((it) => it && kindOf(it) === "문장") },
    ].filter((a) => a.list.length > 0).map((a) => ({ label: a.label, n: a.list.length, ok: okOf(a.list), pct: pctOf(okOf(a.list), a.list.length) }));

    const DRAW = {
      // 영역별 정답률 — 영역이 셋 이상이면 방사형(오각형) 도형, 아니면 막대
      radar(x, y, w, h) {
        card(x, y, w, h, "영역별 정답률");
        if (axes.length < 3) {
          hbars(x + 26, y + 90, w - 52, axes.map((a) => ({ label: `${a.label} ${a.n}`, v: a.pct, color: scoreColor(a.pct) })),
            (v) => (v == null ? "-" : `${v}%`), 100);
          return;
        }
        const wide = w > 1000; // 한 줄을 다 쓸 때는 도형은 왼쪽, 오른쪽에 수치 표
        const cx = wide ? x + w * 0.28 : x + w / 2, cy = y + 60 + (h - 60) / 2;
        const R = Math.min(wide ? w * 0.16 : w * 0.28, (h - 60) / 2 - 70);
        const N = axes.length;
        const pt = (i, r) => {
          const ang = -Math.PI / 2 + (Math.PI * 2 * i) / N;
          return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
        };
        [0.25, 0.5, 0.75, 1].forEach((f) => {
          ctx.beginPath();
          for (let i = 0; i < N; i++) { const [px, py] = pt(i, R * f); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
          ctx.closePath(); ctx.strokeStyle = f === 1 ? "#d9d5f3" : C.line; ctx.lineWidth = 2; ctx.stroke();
        });
        for (let i = 0; i < N; i++) {
          const [px, py] = pt(i, R);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.beginPath();
        axes.forEach((a, i) => { const [px, py] = pt(i, R * Math.max(0.03, a.pct / 100)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.closePath();
        ctx.fillStyle = "rgba(109, 94, 242, 0.22)"; ctx.fill();
        ctx.strokeStyle = C.primary; ctx.lineWidth = 4; ctx.stroke();
        axes.forEach((a, i) => {
          const [px, py] = pt(i, R * Math.max(0.03, a.pct / 100));
          ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fillStyle = C.primaryDeep; ctx.fill();
        });
        axes.forEach((a, i) => {
          const [ax, ay] = pt(i, R + 30);
          const align = Math.abs(ax - cx) < 8 ? "center" : ax > cx ? "left" : "right";
          const dy = ay < cy - R * 0.5 ? -10 : ay > cy + R * 0.5 ? 20 : 6;
          txt(ctx, a.label, ax, ay + dy, { size: 20, weight: 800, color: C.ink, align });
          txt(ctx, `${a.pct}%`, ax, ay + dy + 24, { size: 19, weight: 800, color: scoreColor(a.pct), align });
        });
        if (wide) {
          // 오른쪽 수치 표 — 도형만으로는 몇 문항 중 몇 개인지 알 수 없다
          const tx = x + w * 0.56, tw = w * 0.44 - 26;
          let ty = y + 96;
          axes.forEach((a) => {
            txt(ctx, a.label, tx, ty, { size: 22, weight: 800, color: C.ink2 });
            txt(ctx, `${a.ok} / ${a.n}문항`, tx + tw * 0.45, ty, { size: 21, weight: 700, color: C.muted });
            txt(ctx, `${a.pct}%`, tx + tw, ty, { size: 22, weight: 900, color: scoreColor(a.pct), align: "right" });
            ctx.fillStyle = C.line; ctx.fillRect(tx, ty + 16, tw, 1);
            ty += 56;
          });
        }
      },

      // 오답 입력 유형 — 도넛 + 범례.
      // ⚠️ 이름을 "틀린 이유"라고 붙이면 안 된다 (2026-09-16 코덱스 검토): 답을 비교해서 알 수 있는 것은
      //    "어떻게 썼는가"뿐이고 "왜 틀렸는가"가 아니다. 학부모가 진단으로 읽으면 신뢰를 잃는다.
      causes(x, y, w, h) {
        card(x, y, w, h, "오답 입력 유형", wrongAll.length ? `틀린 문항 ${wrongAll.length}개` : "");
        if (!wrongAll.length) {
          txt(ctx, "틀린 문항이 없습니다", x + w / 2, y + h / 2 + 18, { size: 24, weight: 800, color: C.goodDeep, align: "center" });
          return;
        }
        const count = { typo: 0, other: 0, blank: 0 };
        wrongAll.forEach(({ it }) => { count[causeOf(it)] += 1; });
        const parts = [
          { k: "typo", label: "철자 차이", sub: "정답과 한두 글자 차이", color: C.warn, deep: C.warnDeep },
          { k: "other", label: "정답과 다른 답", sub: "다른 낱말을 씀", color: C.bad, deep: C.badDeep },
          { k: "blank", label: "미응답", sub: "답을 쓰지 않음", color: C.gray, deep: C.ink2 },
        ];
        const n = wrongAll.length;
        const R = Math.min(110, (h - 90) / 2 - 12), cx = x + 44 + R + 14, cy = y + 60 + (h - 60) / 2;
        let a0 = -Math.PI / 2;
        ctx.lineWidth = 34; ctx.lineCap = "butt";
        parts.forEach((p) => {
          if (!count[p.k]) return;
          const a1 = a0 + Math.PI * 2 * count[p.k] / n;
          ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.strokeStyle = p.color; ctx.stroke();
          a0 = a1;
        });
        txt(ctx, String(n), cx, cy + 12, { size: 40, weight: 900, color: C.ink, align: "center" });
        txt(ctx, "틀린 문항", cx, cy + 42, { size: 18, weight: 600, color: C.muted, align: "center" });
        const lx = cx + R + 50, rx = x + w - 26;
        let ly = cy - 66;
        parts.forEach((p) => {
          fillR(ctx, lx, ly - 18, 20, 20, 6, p.color);
          txt(ctx, p.label, lx + 32, ly, { size: 22, weight: 800, color: C.ink });
          txt(ctx, `${count[p.k]}개 · ${pctOf(count[p.k], n)}%`, rx, ly, { size: 22, weight: 800, color: p.deep, align: "right" });
          txt(ctx, p.sub, lx + 32, ly + 26, { size: 17, weight: 600, color: C.muted });
          ly += 68;
        });
      },

      // 풀이 시간 — 문항당 평균 초 (객관식·주관식 / 맞은·틀린)
      time(x, y, w, h) {
        const timed = items.filter((it) => it && Number(it.ms) > 0);
        const avg = (list) => {
          const l = list.filter((it) => it && Number(it.ms) > 0);
          return l.length ? l.reduce((s, it) => s + Number(it.ms), 0) / l.length / 1000 : null;
        };
        card(x, y, w, h, "풀이 시간", timed.length ? `문항당 평균 ${fmtSec(avg(items))}` : "");
        if (!timed.length) {
          txt(ctx, "문항별 시간 기록이 없습니다", x + w / 2, y + h / 2 + 18, { size: 22, weight: 700, color: C.muted, align: "center" });
          return;
        }
        const rows = [];
        if (hasType) rows.push({ label: "객관식", v: avg(choiceItems), color: C.primary }, { label: "주관식", v: avg(typedItems), color: C.primaryDeep });
        rows.push(
          { label: "맞은 문항", v: avg(items.filter((it) => it && it.correct === true)), color: C.good },
          { label: "틀린 문항", v: avg(items.filter((it) => it && it.correct === false)), color: C.bad },
        );
        const max = Math.max(1, ...rows.map((r) => r.v || 0));
        hbars(x + 26, y + 90, w - 52, rows, fmtSec, max);
        const slow = timed.reduce((a, b) => (Number(b.ms) > Number(a.ms) ? b : a));
        txt(ctx, `가장 오래 걸린 문항 ${items.indexOf(slow) + 1}번 · ${fmtSec(Number(slow.ms) / 1000)}`,
          x + 26, y + h - 30, { size: 18, weight: 700, color: C.muted });
      },

      // 구간별 정답률 — 시험을 앞에서부터 나눠 막대로. 뒤로 갈수록 떨어지면 집중력·시간 배분 문제다
      blocks(x, y, w, h) {
        const n = items.length;
        card(x, y, w, h, "구간별 정답률", n ? `전체 평균 ${pct}%` : "");
        if (!n) return;
        const K = n <= 50 ? Math.min(5, n) : 10;
        const size = Math.ceil(n / K);
        const list = [];
        for (let s = 0; s < n; s += size) {
          const part = items.slice(s, s + size).filter(Boolean);
          list.push({ from: s + 1, to: Math.min(n, s + size), pct: pctOf(okOf(part), part.length) });
        }
        const CX = x + 36, CWd = w - 72, top = y + 84, bottom = y + h - 44, CH = bottom - top;
        [0, 50, 100].forEach((v) => { ctx.fillStyle = C.line; ctx.fillRect(CX, bottom - CH * v / 100, CWd, 2); });
        // 평균선을 **막대보다 먼저** 그린다 — 나중에 그리면 점선이 막대와 값 글자를 가로질러 지저분하다
        const ay = bottom - CH * pct / 100;
        ctx.setLineDash([10, 8]); ctx.strokeStyle = C.primaryDeep; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(CX, ay); ctx.lineTo(CX + CWd, ay); ctx.stroke();
        ctx.setLineDash([]);

        const bw = CWd / list.length;
        list.forEach((b, i) => {
          const bh = Math.max(4, CH * b.pct / 100);
          const bx = CX + i * bw + bw * 0.2, bwid = bw * 0.6;
          fillR(ctx, bx, bottom - bh, bwid, bh, Math.min(10, bwid / 4), scoreColor(b.pct));
          // 막대가 꼭대기까지 차면 값 글자가 위쪽 객관식·주관식 라벨과 겹친다 — 그때는 막대 안에 흰 글자로
          let ly = bottom - bh - 8;
          // 막대 위에 적는 값이 평균 점선과 같은 높이면 글자에 점선이 걸린다 — 한 줄 위로 올린다
          if (Math.abs(ly - ay) < 16) ly = ay - 16;
          const inside = ly < top + 14;
          txt(ctx, `${b.pct}%`, bx + bwid / 2, inside ? bottom - bh + 26 : ly,
            { size: 18, weight: 800, color: inside ? C.white : C.ink2, align: "center" });
          txt(ctx, `${b.from}–${b.to}`, bx + bwid / 2, bottom + 28, { size: 17, weight: 700, color: C.muted, align: "center" });
        });
        // 객관식 | 주관식 경계 (출제 순서가 두 묶음일 때) — 막대 사이에 오므로 막대를 가리지 않는다
        if (typeSplit) {
          const vx = CX + CWd * (typeSplit.at / n);
          ctx.setLineDash([10, 8]); ctx.strokeStyle = C.muted; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(vx, top - 10); ctx.lineTo(vx, bottom); ctx.stroke();
          ctx.setLineDash([]);
          txt(ctx, typeSplit.first.label, vx - 12, top - 14, { size: 17, weight: 800, color: C.muted, align: "right" });
          txt(ctx, typeSplit.second.label, vx + 12, top - 14, { size: 17, weight: 800, color: C.muted });
        }
      },
    };

    const cards = ["radar", "causes", "time", "blocks"].filter((k) => want.has(k));
    const HALF = { radar: true, causes: true, time: true, blocks: false };
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i], b = cards[i + 1];
      if (HALF[a] && b && HALF[b]) {
        const G = 24, w = (CW - G) / 2, h = Math.max(CARD_H[a], CARD_H[b]);
        DRAW[a](M, y, w, h);
        DRAW[b](M + w + G, y, w, h);
        y += h + 24;
        i++;
      } else {
        DRAW[a](M, y, CW, FULL_H[a]);
        y += FULL_H[a] + 24;
      }
    }
    if (cards.length) y += 10;

    // ⑥ 문항별 결과 — O/X 격자. 다시 봐야 할 문항 몫(최소 3줄)을 남기고 남은 자리 안에서 칸을 줄인다
    const wrongMin = want.has("wrong") ? 50 + (wrongAll.length ? 48 + 52 * 3 : 102) : 0;
    if (want.has("grid") && items.length) {
      const n = items.length;
      const sub = typeSplit
        ? `${typeSplit.first.label} ${typeSplit.first.r[0]}–${typeSplit.at}  ·  ${typeSplit.second.label} ${typeSplit.at + 1}–${typeSplit.second.r[typeSplit.second.r.length - 1]}`
        : `맞은 문항 ${correct}개 · 틀린 문항 ${wrongN}개`;
      y = section(y, "문항별 결과", sub);
      const maxH = Math.min(GRID_MAX_H, BODY_BOTTOM - y - wrongMin - 36);
      const cols = n <= 50 ? 10 : n <= 200 ? 20 : Math.min(50, Math.ceil(n / 10));
      const rows = Math.ceil(n / cols);
      let GX = cols > 20 ? 4 : 6, GY = GX;
      let cellH = Math.min(cols <= 10 ? 60 : 48, Math.floor((maxH - GY * (rows - 1)) / rows));
      if (cellH < 20) { GX = GY = 2; cellH = Math.floor((maxH - GY * (rows - 1)) / rows); } // 자리가 좁으면 틈을 줄여 칸을 살린다
      const cellW = (CW - GX * (cols - 1)) / cols;
      if (cellH >= 4) {
        const numSize = Math.min(Math.round(cellH * 0.4), Math.floor(cellW / (String(n).length * 0.62)), 22);
        const oxSize = Math.min(Math.round(cellH * 0.34), 20);
        const showNum = numSize >= 10 && cellH >= 30;
        const showOX = oxSize >= 9;
        items.forEach((it, i) => {
          const x = M + (i % cols) * (cellW + GX), cy = y + Math.floor(i / cols) * (cellH + GY);
          const ok = !!it && it.correct === true;
          // 글자를 못 넣을 만큼 작으면 틀린 칸을 진하게 — 흑백으로 뽑아도 맞음(연함)·틀림(진함)이 갈린다
          fillR(ctx, x, cy, cellW, cellH, Math.min(6, cellH / 5), ok ? C.goodSoft : showOX ? C.badSoft : C.bad);
          if (showNum) {
            txt(ctx, String(i + 1), x + cellW / 2, cy + cellH * 0.47,
              { size: numSize, weight: 800, color: ok ? C.goodDeep : C.badDeep, align: "center" });
          }
          // 색만으로 구분되지 않게 O/X를 함께 찍는다 (흑백 인쇄 대비)
          if (showOX) {
            txt(ctx, ok ? "O" : "X", x + cellW / 2, showNum ? cy + cellH * 0.87 : cy + cellH / 2 + oxSize * 0.36,
              { size: oxSize, weight: 900, color: ok ? C.good : C.bad, align: "center" });
          }
        });
        y += rows * cellH + (rows - 1) * GY + 36;
      } else {
        txt(ctx, `문항 ${n}개 — 격자 생략`, M, y + 30, { size: 20, weight: 600, color: C.muted });
        y += 66;
      }
    }

    // ⑦ 다시 봐야 할 문항 — 틀린 문항을 전부 싣는다. 모자라면 장을 늘려 이어 싣는다 (2026-09-16)
    if (want.has("wrong")) {
      y = section(y, "다시 봐야 할 문항", wrongN ? `틀린 문항 ${wrongN}개` : "");
      if (!wrongAll.length) {
        fillR(ctx, M, y + 6, CW, 96, 20, C.goodSoft);
        txt(ctx, total ? "틀린 문항이 없습니다 — 모두 맞혔어요" : "채점된 문항이 없습니다", M + CW / 2, y + 64,
          { size: 26, weight: 800, color: C.goodDeep, align: "center" });
      } else {
        // 2026-09-16 코덱스 검토 반영: 이 표는 학부모가 아이와 **실제로 복습하는 원문**이라
        // 20px(인쇄 7.2pt)은 너무 작았고, "…"로 자르면 결과지에서 가장 중요한 정보가 훼손된다.
        // → 본문 25px·행 52px, 한 줄에 안 들어가면 두 줄(76px)까지 늘려 **자르지 않는다**.
        //   대신 넘치는 만큼 장을 더 쓴다 (틀린 문항을 전부 싣는 것이 규칙이다).
        // 2026-09-16 코덱스 검토 반영: 이 표는 학부모가 아이와 **실제로 복습하는 원문**이라
        // 20px(인쇄 7.2pt)은 너무 작았고, "…"로 자르면 결과지에서 가장 중요한 정보가 훼손된다.
        // → 본문 25px·행 52px, 한 줄에 안 들어가면 두 줄(76px)까지 늘려 **자르지 않는다**.
        //   대신 넘치는 만큼 장을 더 쓴다 (틀린 문항을 전부 싣는 것이 규칙이다).
        const HEAD = 48, RH1 = 52, RH2 = 76, LH = 30, FS = 25, PAD = 14, NUM_W = 88, CG = 28;
        const CONT_TOP = 150;                     // 이어지는 장에서 표가 시작하는 높이 (얇은 머리말 아래)
        const H1 = BODY_BOTTOM - y - HEAD;        // 첫 장에서 줄이 쓸 수 있는 높이
        const HN = BODY_BOTTOM - CONT_TOP - HEAD; // 이어지는 장에서 줄이 쓸 수 있는 높이

        /** 한 단 폭에 맞춰 각 문항을 몇 줄로 그릴지 미리 재 둔다 — 줄 높이가 제각각이라
         *  "한 장에 몇 개"를 개수로는 나눌 수 없다. 두 줄로도 넘치면 거기서만 자른다 */
        const layoutFor = (ncol) => {
          const colW = ncol === 2 ? (CW - CG) / 2 : CW;
          const restW = colW - NUM_W;
          // 두 단일 때는 "학생이 쓴 답"을 빼고 문제·정답만 — 칸이 좁아 셋 다는 안 들어간다
          const heads = ncol === 1 ? ["#", "문제", "정답", "학생이 쓴 답"] : ["#", "문제", "정답"];
          const widths = ncol === 1 ? [NUM_W, restW * 0.36, restW * 0.32, restW * 0.32] : [NUM_W, restW * 0.46, restW * 0.54];
          const rows = wrongAll.map(({ it, no }) => {
            const typed = String(it.typed == null ? "" : it.typed).trim();
            const cells = [
              { s: String(no), w: 800, c: C.muted },
              { s: it.prompt, w: 600, c: C.ink },
              { s: it.answer, w: 800, c: C.goodDeep },
              { s: typed || "(답 없음)", w: 700, c: typed ? C.badDeep : C.muted },
            ].slice(0, heads.length);
            // ⚠️ 문항 번호는 절대 접지 않는다 — 접히면 "102"가 "10 / 2" 두 줄로 나온다(실제로 겪음)
            const lines = cells.map((cell, i) => (i === 0 ? [cell.s] : wrap(ctx, cell.s, widths[i] - PAD * 2, FS, cell.w).slice(0, 2)));
            return { cells, lines, h: lines.some((l) => l.length > 1) ? RH2 : RH1 };
          });
          return { colW, heads, widths, rows };
        };

        /** 장마다 들어갈 만큼 담는다. 마지막 장은 단끼리 높이를 맞춰 나눈다
         *  (안 그러면 마지막 장 왼쪽 단만 꽉 차고 오른쪽이 텅 빈다) */
        const fill = (lay, ncol) => {
          const H = lay.rows.map((r) => r.h);
          const pages = [];
          let i = 0;
          while (i < H.length) {
            const avail = pages.length === 0 ? H1 : HN;
            const from = i;
            for (let c = 0; c < ncol && i < H.length; c++) {
              let used = 0;
              while (i < H.length && used + H[i] <= avail) { used += H[i]; i++; }
            }
            if (i === from) { if (pages.length === 0) pages.push({ from, to: from, avail }); else break; }
            else pages.push({ from, to: i, avail });
            if (i === from && pages.length > 1) break; // 한 줄도 못 담으면 멈춘다(무한 루프 방지)
          }
          // 마지막 장만 높이를 맞춰 나눈다
          const cuts = pages.map((pg, pi) => {
            const idx = [];
            let k = pg.from;
            if (pi < pages.length - 1 || ncol === 1) {
              for (let c = 0; c < ncol; c++) {
                let used = 0; const part = [];
                while (k < pg.to && used + H[k] <= pg.avail) { used += H[k]; part.push(k++); }
                idx.push(part);
              }
            } else {
              let left = 0;
              for (let t = pg.from; t < pg.to; t++) left += H[t];
              for (let c = 0; c < ncol; c++) {
                const target = left / (ncol - c);
                let used = 0; const part = [];
                while (k < pg.to && used + H[k] <= pg.avail && (used < target || c === ncol - 1)) {
                  used += H[k]; left -= H[k]; part.push(k++);
                }
                idx.push(part);
              }
            }
            return idx;
          });
          return { pages, cuts, nPages: Math.max(1, pages.length) };
        };

        // 한 단으로도 장수가 같으면 한 단으로 — 그래야 "학생이 쓴 답"까지 보여 줄 수 있다 (2026-09-16)
        const lay1 = layoutFor(1), f1 = fill(lay1, 1);
        const lay2 = layoutFor(2), f2 = fill(lay2, 2);
        const oneCol = f1.nPages <= f2.nPages;
        const lay = oneCol ? lay1 : lay2, f = oneCol ? f1 : f2, ncol = oneCol ? 1 : 2;
        const nPages = f.nPages;
        if (f.pages.length && f.pages[0].from === f.pages[0].to) {
          txt(ctx, "다음 장에 이어집니다", M, y + 30, { size: 21, weight: 600, color: C.muted });
        }

        // 늘어난 장만큼 캔버스를 다시 만든다 — 캔버스는 크기를 바꾸면 그려 둔 것이 지워지므로 옮겨 그린다
        if (nPages > 1) {
          const tall = document.createElement("canvas");
          tall.width = W; tall.height = PAGE_H * nPages;
          const g = tall.getContext("2d");
          g.fillStyle = C.white; g.fillRect(0, 0, tall.width, tall.height);
          g.drawImage(canvas, 0, 0);
          canvas.width = canvas.height = 0;       // 15MB짜리 첫 장을 바로 놓아 준다
          canvas = tall; ctx = g;
          for (let p = 1; p < nPages; p++) {      // 흩어져도 누구 것인지 알 수 있게 얇은 머리말
            const py = p * PAGE_H;
            txt(ctx, fit(ctx, `${who} · ${deckName}`, CW - 380, 24, 800), M, py + 62, { size: 24, weight: 800, color: C.ink });
            txt(ctx, "다시 봐야 할 문항", W - M, py + 62, { size: 24, weight: 600, color: C.muted, align: "right" });
            ctx.fillStyle = C.line; ctx.fillRect(M, py + 88, CW, 1.5);
            ctx.fillStyle = C.primary; ctx.fillRect(M, py + 86, 80, 4);
          }
        }

        f.cuts.forEach((page, pi) => {
          const top = pi === 0 ? y : pi * PAGE_H + CONT_TOP;
          page.forEach((part, c) => {
            if (!part.length) return;
            const x0 = M + c * (lay.colW + CG);
            fillR(ctx, x0, top, lay.colW, HEAD, 8, C.primarySoft);
            let hx = x0;
            lay.heads.forEach((h, i) => {
              txt(ctx, h, hx + PAD, top + 32, { size: 21, weight: 800, color: C.primaryDeep });
              hx += lay.widths[i];
            });
            let ry = top + HEAD;
            part.forEach((ix, r) => {
              const row = lay.rows[ix];
              if (r % 2 === 1) { ctx.fillStyle = C.zebra; ctx.fillRect(x0, ry, lay.colW, row.h); }
              const base = row.h === RH2 ? 31 : 34; // 두 줄이면 위로 올려 두 줄이 칸 가운데 오게
              let cx = x0;
              row.cells.forEach((cell, i) => {
                row.lines[i].forEach((line, li) => {
                  txt(ctx, line, cx + PAD, ry + base + li * LH, { size: FS, weight: cell.w, color: cell.c });
                });
                cx += lay.widths[i];
              });
              ctx.fillStyle = C.line; ctx.fillRect(x0, ry + row.h - 1, lay.colW, 1);
              ry += row.h;
            });
          });
        });
      }
    }

    // 여러 장이면 쪽 번호 — 인쇄해서 섞여도 순서를 알 수 있게 (한 장이면 넣지 않는다)
    const pages = Math.max(1, Math.round(canvas.height / PAGE_H));
    if (pages > 1) {
      for (let p = 0; p < pages; p++) {
        txt(ctx, `${p + 1} / ${pages}`, W - M, p * PAGE_H + PAGE_H - 60,
          { size: 21, weight: 700, color: C.muted, align: "right" });
      }
    }

    // 꼬리말 없음 (2026-09-15 사용자 요청 — "자동으로 만들어졌습니다" 같은 안내 문구는 싣지 않는다.
    // 발행일은 머리말에 이미 있다)
    return { canvas: canvas, width: W, height: canvas.height, pages: pages };
  }

  // ── 내보내기 ─────────────────────────────────────────────────────────────
  const fileSafe = (s) => String(s || "결과지").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

  /** JPG 한 장 — 폰으로 바로 보낼 수 있는 형태 */
  function saveJpeg(canvas, name) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileSafe(name)}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve(true);
      }, "image/jpeg", 0.94);
    });
  }

  /** 캔버스를 A4 한 장씩 잘라 돌려준다 (결과지는 이제 늘 한 장 — 평가분석지도 같은 함수를 쓴다) */
  function slice(canvas) {
    const out = [];
    for (let y = 0; y < canvas.height; y += PAGE_H) {
      const h = Math.min(PAGE_H, canvas.height - y);
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(canvas, 0, y, c.width, h, 0, 0, c.width, h);
      out.push(c.toDataURL("image/jpeg", 0.94));
    }
    return out;
  }

  /** 쪽 이미지 여러 장 → 브라우저 인쇄("PDF로 저장"). 숙제지처럼 여러 장인 문서가 쓴다.
   *  새 창 대신 숨은 iframe을 쓴다 — 팝업 차단에 걸리지 않고, 끝나면 알아서 사라진다. */
  function printImages(pages, title) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${
      String(title || "시험 결과지").replace(/[<>&]/g, "")
    }</title><style>
      @page { size: A4; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      img { display: block; width: 100%; break-after: page; page-break-after: always; }
      img:last-child { break-after: auto; page-break-after: auto; }
    </style></head><body>${pages.map((src) => `<img src="${src}">`).join("")}</body></html>`);
    doc.close();
    const go = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* 무시 */ }
      setTimeout(() => frame.remove(), 60000); // 인쇄 대화상자가 떠 있는 동안은 남겨 둔다
    };
    // 이미지가 다 그려진 뒤에 인쇄해야 빈 종이가 나오지 않는다
    if (doc.readyState === "complete") setTimeout(go, 150);
    else frame.onload = () => setTimeout(go, 150);
  }
  /** 캔버스 한 장(결과지·평가분석지) 인쇄 */
  const print = (canvas, title) => printImages(slice(canvas), title);

  // draw — 평가분석지(eval-report.js)·숙제지(exam-homework.js)가 같은 붓·색·여백으로 그리도록 도우미를 함께 내보낸다.
  //        두 문서가 따로 그리면 글꼴·색·여백이 조금씩 어긋난다.
  window.IjwExamReport = {
    render, saveJpeg, print, printImages, slice, PAGE_H, WIDTH: W, SECTIONS, PRESETS,
    draw: { C, FONT, font, rrect, fillR, strokeR, txt, widthOf, wrap, fit, fmtDate, fmtDur, loadLogo, M, CW, FOOT_RESERVE, CONT_H },
  };
})();
