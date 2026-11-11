import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "모임 참석 · 비용 정산",
  description: "모임 참석자와 비용 정산을 관리하는 사이트",
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
