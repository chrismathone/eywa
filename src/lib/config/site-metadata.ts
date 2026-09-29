import type { Metadata } from "next";

export const AYWA_SITE_URL = "https://www.aywa.co.kr";
export const AYWA_SITE_TITLE = "에이와 | 학원 운영을 한눈에";
/** 페이지 제목 접미사(화면 표기 = "에이와", 원장 2026-09-28). 한글 리터럴 0 가드가 걸린 page.tsx는 이 상수를 쓴다. */
export const PAGE_TITLE_SUFFIX = " — 에이와";
export const AYWA_SITE_DESCRIPTION = "출결·시간표·수납·상담·학부모 알림까지, 학원 운영에 필요한 일을 한곳에서 관리하세요.";

/** Public product information only, including when a private app link is shared. */
export const AYWA_SHARE_METADATA = {
  metadataBase: new URL(AYWA_SITE_URL),
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "에이와",
    url: AYWA_SITE_URL,
    title: AYWA_SITE_TITLE,
    description: AYWA_SITE_DESCRIPTION,
    images: [{
      url: "/og/aywa-v1.png",
      width: 1200,
      height: 630,
      type: "image/png",
      alt: "에이와 — 학원 운영을 한눈에. 출결부터 수납, 상담까지.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: AYWA_SITE_TITLE,
    description: AYWA_SITE_DESCRIPTION,
    images: [{ url: "/og/aywa-v1.png", alt: "에이와 — 학원 운영을 한눈에" }],
  },
} satisfies Metadata;
