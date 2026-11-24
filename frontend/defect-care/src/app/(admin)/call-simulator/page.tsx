"use client";

import { FileText, PhoneCall } from "lucide-react";
import { useState } from "react";
import AgentCall from "@/components/AgentCall";
import TranscriptAnalyzer from "@/components/TranscriptAnalyzer";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "call", label: "AI 상담원 통화", icon: PhoneCall },
  { id: "transcript", label: "녹취록 분석", icon: FileText },
] as const;

export default function CallSimulatorPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("call");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 sm:w-fit" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium sm:flex-none",
              tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      {tab === "call" ? <AgentCall /> : <TranscriptAnalyzer />}
    </div>
  );
}
