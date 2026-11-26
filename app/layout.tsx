import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./design-polish.css";
import "./design-polish-phase2.css";

const siteUrl = "https://gangseojjinc.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "찐친만들기 모임페이지",
  description: "강서구 찐친만들기 모임 일정과 참석, 비용 정산을 함께 관리하는 페이지입니다.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "강서구 찐친만들기",
    url: "/",
    title: "찐친만들기 모임페이지",
    description: "강서구 찐친만들기 모임 일정과 참석, 비용 정산을 함께 관리하는 페이지입니다.",
  },
  twitter: {
    card: "summary",
    title: "찐친만들기 모임페이지",
    description: "강서구 찐친만들기 모임 일정과 참석, 비용 정산을 함께 관리하는 페이지입니다.",
  },
};

// 휴대폰 브라우저(삼성 인터넷 · 크롬)의 "강제 다크 모드"가 바둑돌·판 색을 바꿔 버려서 끈다.
// 이 사이트는 밝은 화면 하나로 디자인되어 있다.
export const viewport: Viewport = {
  colorScheme: "only light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
