"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { DEFECT_TYPES, URGENCIES } from "@/lib/constants";
import { formatPhone, isValidPhone, NAME_MAX, nameProblem, normalizeDongHo, normalizeName } from "@/lib/normalize";
import type { Apartment, AssignmentResult, Complaint, ComplaintInput } from "@/lib/types";
import { ErrorBox } from "./ui";

export type FormValues = Omit<ComplaintInput, "channel" | "callTranscript" | "aiSummary" | "region">;

export const EMPTY_FORM: FormValues = {
  complainantName: "",
  phone: "",
  apartmentName: "",
  building: "",
  unit: "",
  defectType: "ETC",
  description: "",
  urgency: "NORMAL",
  photos: [],
};

const MAX_PHOTOS = 5;

/** 업로드 이미지를 최대 1280px JPEG로 축소해 data URL로 변환 */
async function resizeImage(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Props {
  initial?: FormValues;
  extra?: Pick<ComplaintInput, "channel" | "callTranscript" | "aiSummary">;
  submitLabel?: string;
  onCreated: (result: { complaint: Complaint; assignment: AssignmentResult | null }) => void;
}

export default function ComplaintForm({ initial = EMPTY_FORM, extra, submitLabel = "접수 및 자동 배정", onCreated }: Props) {
  const [v, setV] = useState<FormValues>(initial);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 초기값이 바뀌어야 하면 부모에서 key를 바꿔 다시 마운트합니다.
  useEffect(() => {
    api<{ apartments: Apartment[] }>("/api/meta").then((m) => setApartments(m.apartments)).catch(() => {});
  }, []);

  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const region = apartments.find((a) => a.name === v.apartmentName)?.region;
  const nameWarn = v.complainantName.trim() ? nameProblem(v.complainantName) : null;
  const phoneWarn = v.phone.trim().length >= 9 && !isValidPhone(v.phone);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - (v.photos?.length ?? 0);
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room);
    const urls = await Promise.all(picked.map((f) => resizeImage(f)));
    setV((p) => ({ ...p, photos: [...(p.photos ?? []), ...urls] }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api<{ complaint: Complaint; assignment: AssignmentResult | null }>("/api/complaints", {
        method: "POST",
        json: { ...v, ...extra },
      });
      onCreated(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">민원인 이름 * <span className="font-normal text-slate-400">(최대 {NAME_MAX}글자)</span></label>
          <input
            className="input"
            placeholder="홍길동"
            value={v.complainantName}
            onChange={(e) => set("complainantName", e.target.value)}
            onBlur={() => set("complainantName", normalizeName(v.complainantName))}
          />
          {nameWarn && <p className="mt-1 text-xs text-red-600">{nameWarn}</p>}
        </div>
        <div>
          <label className="label">전화번호 *</label>
          <input
            className="input tabular-nums"
            inputMode="tel"
            placeholder="010-1234-5678"
            value={v.phone}
            onChange={(e) => set("phone", e.target.value)}
            onBlur={() => v.phone && set("phone", formatPhone(v.phone))}
          />
          {phoneWarn && <p className="mt-1 text-xs text-red-600">010-1234-5678 형식으로 입력하세요.</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">
            아파트명 * {region && <span className="ml-1 font-normal text-blue-600">· 지역: {region}</span>}
          </label>
          <input
            className="input"
            list="apartment-list"
            placeholder="단지명을 입력하거나 선택"
            value={v.apartmentName}
            onChange={(e) => set("apartmentName", e.target.value)}
          />
          <datalist id="apartment-list">
            {apartments.map((a) => (
              <option key={a.id} value={a.name}>{a.region}</option>
            ))}
          </datalist>
          {v.apartmentName && apartments.length > 0 && !region && (
            <p className="mt-1 text-xs text-amber-600">등록되지 않은 단지입니다. 지역을 알 수 없어 관리자 확인 대기로 접수됩니다.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <div>
            <label className="label">동 *</label>
            <div className="relative">
              <input className="input pr-8" inputMode="numeric" placeholder="101" value={v.building} onChange={(e) => set("building", e.target.value)} onBlur={() => set("building", normalizeDongHo(v.building))} />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-400">동</span>
            </div>
          </div>
          <div>
            <label className="label">호수 *</label>
            <div className="relative">
              <input className="input pr-8" inputMode="numeric" placeholder="1502" value={v.unit} onChange={(e) => set("unit", e.target.value)} onBlur={() => set("unit", normalizeDongHo(v.unit))} />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-400">호</span>
            </div>
          </div>
        </div>
        <div>
          <label className="label">하자 유형 *</label>
          <select className="input" value={v.defectType} onChange={(e) => set("defectType", e.target.value as FormValues["defectType"])}>
            {DEFECT_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">긴급도 *</label>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
            {URGENCIES.map((u) => (
              <button
                type="button"
                key={u.value}
                onClick={() => set("urgency", u.value)}
                className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                  v.urgency === u.value ? (u.value === "EMERGENCY" ? "bg-red-600 text-white" : "bg-white text-slate-900 shadow-sm") : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">상세 민원 내용 *</label>
          <textarea className="input min-h-28" value={v.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">사진 첨부 (최대 {MAX_PHOTOS}장)</label>
          <div className="flex flex-wrap gap-2">
            {v.photos?.map((src, i) => (
              <div key={i} className="relative size-20 overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`첨부 사진 ${i + 1}`} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => set("photos", v.photos!.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 rounded-full bg-slate-900/70 p-0.5 text-white"
                  aria-label="사진 삭제"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {(v.photos?.length ?? 0) < MAX_PHOTOS && (
              <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500">
                <ImagePlus className="size-5" />
                <span className="text-[11px]">추가</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
