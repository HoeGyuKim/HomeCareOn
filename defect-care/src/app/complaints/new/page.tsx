"use client";

import { useRouter } from "next/navigation";
import ComplaintForm from "@/components/ComplaintForm";
import { SectionTitle } from "@/components/ui";

export default function NewComplaintPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <section className="card">
        <SectionTitle title="민원 직접 등록" />
        <div className="p-5">
          <p className="mb-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            저장하면 하자 유형과 단지 지역을 기준으로 계약 업체가 자동 배정되고 업체에 작업 요청이 전달됩니다.
          </p>
          <ComplaintForm
            extra={{ channel: "MANUAL" }}
            onCreated={({ complaint }) => router.push(`/complaints/${complaint.id}?created=1`)}
          />
        </div>
      </section>
    </div>
  );
}
