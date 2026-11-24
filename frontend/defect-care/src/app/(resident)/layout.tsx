/** 거주자용 화면 (문자 링크로 여는 페이지): 관리자 사이드바 없이 모바일 우선 */
export default function ResidentLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-slate-50">{children}</main>;
}
