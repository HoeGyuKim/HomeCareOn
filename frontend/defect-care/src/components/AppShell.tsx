"use client";

import { Building2, ClipboardList, LayoutDashboard, Menu, PhoneCall, PlusCircle, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/complaints", label: "민원 접수 관리", icon: ClipboardList },
  { href: "/complaints/new", label: "민원 직접 등록", icon: PlusCircle },
  { href: "/call-simulator", label: "AI 전화 접수", icon: PhoneCall },
  { href: "/contractors", label: "업체 관리", icon: Building2 },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/complaints") return pathname === "/complaints" || /^\/complaints\/(?!new)/.test(pathname);
  return pathname.startsWith(href);
}

interface Meta {
  analyzer: "claude" | "rule-based";
  storage: "memory" | "supabase";
}

/** 현재 경로에 따라 활성 메뉴를 표시 (usePathname은 Suspense 안에서 사용) */
function NavLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active ? "bg-blue-600 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="size-4.5 shrink-0" />
              {label}
            </Link>
          </li>
        );
      })}
    </>
  );
}

function PageTitle() {
  const pathname = usePathname();
  return <>{NAV.find((n) => isActive(pathname, n.href))?.label ?? "민원 상세"}</>;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, []);

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-blue-500">
          <Wrench className="size-4.5 text-white" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">하자보수 민원센터</p>
          <p className="text-[11px] text-slate-400">AI 접수 · 자동 배정</p>
        </div>
      </div>
      <ul className="flex-1 space-y-1 p-3">
        <Suspense fallback={null}>
          <NavLinks onNavigate={() => setOpen(false)} />
        </Suspense>
      </ul>
      <div className="space-y-1.5 border-t border-white/10 p-4 text-[11px] text-slate-400">
        <p className="flex items-center justify-between">
          <span>통화 분석</span>
          <span className={meta?.analyzer === "claude" ? "text-emerald-400" : "text-amber-300"}>
            {meta ? (meta.analyzer === "claude" ? "Claude API" : "규칙 기반(테스트)") : "…"}
          </span>
        </p>
        <p className="flex items-center justify-between">
          <span>데이터 저장소</span>
          <span className={meta?.storage === "supabase" ? "text-emerald-400" : "text-amber-300"}>
            {meta ? (meta.storage === "supabase" ? "Supabase" : "메모리(테스트)") : "…"}
          </span>
        </p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen">
      {/* 데스크톱 사이드바 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-900 lg:block">{sidebar}</aside>

      {/* 모바일 드로어 */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900 shadow-xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-3 rounded p-1 text-slate-400 hover:text-white"
              aria-label="메뉴 닫기"
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:h-16 lg:px-8">
          <button
            onClick={() => setOpen(true)}
            className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="truncate text-base font-semibold text-slate-900 lg:text-lg">
            <Suspense fallback={null}>
              <PageTitle />
            </Suspense>
          </h1>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <Link href="/call-simulator" className="btn-primary">
              <PhoneCall className="size-4" />
              AI 전화 접수
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
