import Link from "@/components/ui/access-link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const base = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-700 hover:bg-slate-100",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function LinkButton({ href, variant = "secondary", children, className, ...rest }: { href: string; variant?: Variant; children: ReactNode; className?: string } & Omit<ComponentProps<typeof Link>, "href">) {
  return <Link href={href} className={cn(base, variants[variant], className)} {...rest}>{children}</Link>;
}
