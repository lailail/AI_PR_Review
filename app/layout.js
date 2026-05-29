import "./globals.css";

export const metadata = {
  title: "AI PR Review Assistant",
  description: "AI assisted GitHub Pull Request review tool",
};

/**
 * 应用根布局。
 * 这里统一定义页面语言、全局字体结构和应用外壳，后续新增页面会共享该布局。
 */
export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
