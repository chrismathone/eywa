"use client";

/**
 * 인재원 **SRS 결과지 그대로**(원장 2026-09-28) — 인재원의 캔버스 결과지(`public/ijw/exam-report.js`, 원본 복사본)로 그린 A4 쪽들을
 * 이미지로 싣는다. 인재원 화면에서 'JPG 저장'한 것과 같은 그림이 학부모 카드(/r·인쇄·ClassNote 캡처)에 들어간다.
 *
 * 🔑 데이터 = `srsSheetDataOf`(srs-sheet.ts). 문항 목록이 없는 응시(옛 동결본·인재원이 문항을 주기 전)는 이 부품을 쓰지 않는다
 *    (호출부가 aywa 결과지로 그린다).
 * 🔑 글꼴 — 캔버스는 이름으로 글꼴을 찾는다("Pretendard Variable"). aywa의 Pretendard는 next/font라 이름이 해시로 바뀌어 있어,
 *    **페이지가 이미 받은 그 파일**(스타일시트의 @font-face 주소)을 그 이름으로 한 번 더 등록한다 — 캐시에 있어 다시 받지 않는다
 *    (2MB). 못 찾으면 `/fonts/PretendardVariable.woff2`. 등록을 안 하면 맑은 고딕으로 그려져 줄 폭이 어긋난다.
 * 🔴 그리는 동안엔 **aywa 결과지(`fallback`)를 보이고** `data-render-pending`을 단다 — 새 ClassNote 워커는 이 표식이 사라질 때까지
 *    기다렸다가 캡처하고, 표식을 모르는 옛 워커(발송 PC zip 재배포 전)가 일찍 찍더라도 **빈 칸이 아니라 aywa 결과지**가 나간다.
 *    그리다 실패하면 aywa 결과지 그대로 남는다.
 */
import { useEffect, useState, type ReactNode } from "react";
import { SRS_SECTIONS, type SrsSheetData } from "../srs-sheet";

type IjwExamReportApi = {
  render: (data: SrsSheetData, opts: { sections: readonly string[] }) => Promise<{ canvas: HTMLCanvasElement }>;
  slice: (canvas: HTMLCanvasElement) => string[];
};

declare global {
  interface Window {
    IjwExamReport?: IjwExamReportApi;
  }
}

const SCRIPT_SRC = "/ijw/exam-report.js?v=20260928";
const FONT_FAMILY = "Pretendard Variable";
const FONT_FALLBACK_SRC = "/fonts/PretendardVariable.woff2";

/** 페이지가 이미 받은 Pretendard 파일 주소 — next/font가 만든 @font-face에서 찾는다(같은 출처 스타일시트만 읽힌다). */
function pagePretendardUrl(): string {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 다른 출처 스타일시트
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family").toLowerCase();
      const m = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(rule.style.getPropertyValue("src"));
      // 스타일시트 기준 상대 주소일 수 있다 — 문서 기준으로 풀어 둔다(FontFace는 문서 기준으로 푼다).
      if (family.includes("pretendard") && m) return new URL(m[1]!, sheet.href ?? location.href).href;
    }
  }
  return FONT_FALLBACK_SRC;
}

let loading: Promise<IjwExamReportApi> | null = null;

/** 결과지 그리는 파일 + 글꼴 — 한 페이지에서 한 번만 받는다. 실패하면 다음 호출이 다시 시도한다. */
function loadRenderer(): Promise<IjwExamReportApi> {
  if (window.IjwExamReport) return Promise.resolve(window.IjwExamReport);
  loading ??= (async () => {
    const font = (async () => {
      if (typeof FontFace === "undefined" || !document.fonts) return;
      const already = [...document.fonts].some((f) => f.family.replace(/["']/g, "") === FONT_FAMILY);
      if (already) return;
      const face = new FontFace(FONT_FAMILY, `url(${pagePretendardUrl()})`, { weight: "45 920" });
      document.fonts.add(await face.load());
    })().catch(() => {}); // 글꼴을 못 받아도 결과지는 나와야 한다(대체 글꼴)
    const script = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = SCRIPT_SRC;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("결과지 파일을 불러오지 못했습니다"));
      document.head.appendChild(el);
    });
    await Promise.all([font, script]);
    if (!window.IjwExamReport) throw new Error("결과지 파일이 비어 있습니다");
    return window.IjwExamReport;
  })().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

export function JjSrsExamSheet({ data, fallback }: { data: SrsSheetData; fallback: ReactNode }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  // 같은 응시를 다시 그리지 않도록 데이터 모양으로 키를 만든다(부모가 매 렌더 새 객체를 넘겨도 안정).
  const key = JSON.stringify(data);

  useEffect(() => {
    let alive = true;
    loadRenderer()
      .then(async (api) => {
        const rep = await api.render(JSON.parse(key) as SrsSheetData, { sections: SRS_SECTIONS });
        const out = api.slice(rep.canvas);
        if (alive) setPages(out);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  if (failed) return <>{fallback}</>;
  if (!pages) return <div data-render-pending="">{fallback}</div>;
  return (
    <div className="flex flex-col gap-2">
      {pages.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- 캔버스에서 만든 data URL(최적화 대상 아님)
        <img
          key={i}
          src={src}
          alt={`${data.deckName} 시험 결과지${pages.length > 1 ? ` ${i + 1}쪽` : ""}`}
          className="bg-card shadow-card w-full rounded-2xl"
        />
      ))}
    </div>
  );
}
