import type { Metadata } from "next";

export const EYWA_SITE_URL = "https://www.aywa.co.kr";
export const EYWA_SITE_TITLE = "EYWA | 학원 운영을 한눈에";
export const EYWA_SITE_DESCRIPTION = "출결·시간표·수납·상담·학부모 알림까지, 학원 운영에 필요한 일을 한곳에서 관리하세요.";

/** Public product information only, including when a private app link is shared. */
export const EYWA_SHARE_METADATA = {
  metadataBase: new URL(EYWA_SITE_URL),
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "EYWA",
    url: EYWA_SITE_URL,
    title: EYWA_SITE_TITLE,
    description: EYWA_SITE_DESCRIPTION,
    images: [{
      url: "/og/eywa-v1.png",
      width: 1200,
      height: 630,
      type: "image/png",
      alt: "EYWA — 학원 운영을 한눈에. 출결부터 수납, 상담까지.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: EYWA_SITE_TITLE,
    description: EYWA_SITE_DESCRIPTION,
    images: [{ url: "/og/eywa-v1.png", alt: "EYWA — 학원 운영을 한눈에" }],
  },
} satisfies Metadata;
