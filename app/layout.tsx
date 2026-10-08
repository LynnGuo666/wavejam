import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "挥手即兴 WaveJam · 全民K歌即兴模式",
  description: "伴奏跟着你：挥手控速，点击指挥声部进出 —— TME AI Hackathon 赛道一 Demo",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
