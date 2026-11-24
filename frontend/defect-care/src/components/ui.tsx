import { Loader2 } from "lucide-react";
import { STATUS_LABEL, STATUS_STYLE, URGENCY_LABEL, URGENCY_STYLE } from "@/lib/constants";
import type { ComplaintStatus, Urgency } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: ComplaintStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", URGENCY_STYLE[urgency])}>
      {URGENCY_LABEL[urgency]}
    </span>
  );
}

export function Spinner({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {action}
    </div>
  );
}
