# 题迹 · LeetTrack

一个可以安装到 iPhone 主屏幕的力扣刷题记录 PWA。

## 功能

- 记录题号、难度、掌握程度、标签、用时、尝试次数和解题笔记
- 本周目标、连续打卡、最近 7 天活跃趋势和难度分布
- 搜索、难度筛选、重点收藏和高频标签统计
- 浅色、深色和跟随系统外观
- 导出与导入 JSON 备份
- 离线访问与 iPhone 主屏幕安装

所有刷题数据只保存在当前浏览器的本地存储中，不会上传到 GitHub。

## 在线使用

[打开题迹](https://zane-woo.github.io/leet-track/)

在 iPhone Safari 中打开后，点击“分享”，选择“添加到主屏幕”。

## 本地开发

```bash
npm install
npm run dev
```

生成 GitHub Pages 静态站点：

```bash
npm run build:pages
```
