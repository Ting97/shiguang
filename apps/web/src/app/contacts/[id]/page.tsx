/**
 * 联系人详情页（静态导出壳）：generateStaticParams 只产出壳页 out/contacts/__shell__.html，
 * 任意 /contacts/<id> 由 apps/api 静态托管回退到壳页；真实 id 由客户端 useParams 从 URL 读取。
 */
import { ContactDetailPage } from "./detail";

export function generateStaticParams() {
  return [{ id: "__shell__" }];
}

export default function Page() {
  return <ContactDetailPage />;
}
