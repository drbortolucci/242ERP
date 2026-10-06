export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-brand-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 text-center text-2xl font-bold">242<span className="text-brand-600">ERP</span></div>
        {children}
      </div>
    </div>
  );
}
