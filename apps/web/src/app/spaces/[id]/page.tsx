import Detail from "./detail";

/** 静态导出动态路由壳：真实 id 由客户端从 URL 解析（同 contacts/[id] 先例） */
export function generateStaticParams() {
  return [{ id: "__shell__" }];
}

export default function SpaceDetailPage() {
  return <Detail />;
}
