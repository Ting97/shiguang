import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center text-slate-100">
      <p className="text-5xl">🕯️</p>
      <h1 className="mt-4 text-xl font-semibold">这一页没有找到</h1>
      <p className="mt-2 text-sm text-slate-500">页面可能已被移动或删除</p>
      <Link
        href="/"
        className="mt-6 btn-primary rounded-xl px-5 py-2 text-sm font-medium"
      >
        返回动态
      </Link>
    </main>
  );
}
