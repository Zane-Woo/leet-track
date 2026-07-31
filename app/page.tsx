import type { Metadata } from "next";
import { LeetTrackApp } from "./LeetTrackApp";

const imageUrl = "https://zane-woo.github.io/leet-track/og.png";

export const metadata: Metadata = {
  title: "题迹 · 力扣刷题记录",
  description: "记录每一道题，看见每一点进步。数据只保存在你的设备上。",
  openGraph: {
    title: "题迹 · 力扣刷题记录",
    description: "记录每一道题，看见每一点进步。",
    images: [{ url: imageUrl, width: 1734, height: 907, alt: "题迹应用预览" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "题迹 · 力扣刷题记录",
    description: "记录每一道题，看见每一点进步。",
    images: [imageUrl],
  },
};

export default function Home() {
  return <LeetTrackApp />;
}
