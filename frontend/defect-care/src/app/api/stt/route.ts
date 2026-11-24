import type { NextRequest } from "next/server";
import { DIALOGUE_API_URL } from "@/lib/agent/dialogue-engine";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return new Response("Missing audio file", { status: 400 });
    }

    const backendFormData = new FormData();
    backendFormData.append("file", file);

    const res = await fetch(`${DIALOGUE_API_URL}/api/stt`, {
      method: "POST",
      body: backendFormData,
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(errText, { status: res.status });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err: any) {
    console.error("[STT Proxy Error]", err);
    return new Response(err?.message || "Internal Server Error", { status: 500 });
  }
}
