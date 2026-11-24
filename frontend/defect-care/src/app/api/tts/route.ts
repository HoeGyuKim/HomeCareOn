import type { NextRequest } from "next/server";
import { DIALOGUE_API_URL } from "@/lib/agent/dialogue-engine";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text");
  const voice = searchParams.get("voice") || "ko-KR-SunHiNeural";

  if (!text) {
    return new Response("Missing text parameter", { status: 400 });
  }

  try {
    const res = await fetch(
      `${DIALOGUE_API_URL}/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      const errText = await res.text();
      return new Response(errText, { status: res.status });
    }

    const audioBuffer = await res.arrayBuffer();
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    console.error("[TTS Proxy Error]", err);
    return new Response(err?.message || "Internal Server Error", { status: 500 });
  }
}
