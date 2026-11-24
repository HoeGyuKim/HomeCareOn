import AppShell from "@/components/AppShell";

/** 관리자 화면 공통 레이아웃 (사이드바). 거주자용 화면은 (resident) 그룹에서 사이드바 없이 보여 줍니다. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
