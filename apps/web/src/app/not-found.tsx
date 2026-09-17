import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100">
      <p className="text-5xl">🕯️</p>
      <h1 className="mt-4 text-xl font-semibold">这一页没有找到</h1>
      <p className="mt-2 text-sm text-slate-500">页面可能已被移动或删除</p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-sky-600 px-5 py-2 text-sm hover:bg-sky-500"
      >
        返回工作台
      </Link>
    </main>
  );
}
