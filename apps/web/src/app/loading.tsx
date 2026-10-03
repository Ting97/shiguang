export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center text-ink-mute">
      <div className="space-y-3 pt-6" aria-hidden>
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" style={{ opacity: 0.82 }} />
        <div className="skeleton h-24 rounded-2xl" style={{ opacity: 0.64 }} />
      </div>
    </main>
  );
}
