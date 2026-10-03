/**
 * 路由切换过渡（REQ-009 FR-B3）：每次导航对新页面树做一次轻淡入。
 * 只用 opacity（不用 transform）——避免动画期间破坏子树内 fixed 定位的包含块。
 * reduced-motion 由全局媒体查询关停。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
