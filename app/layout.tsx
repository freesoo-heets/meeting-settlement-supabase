import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "모임 참석 · 비용 정산",
  description: "모임 참석자와 비용 정산을 관리하는 사이트",
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
