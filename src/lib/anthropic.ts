// Client-side entry point for Jarvis AI calls. Routes every request through the
// local server proxy (/api/anthropic) so the Anthropic API key lives ONLY on the
// server (Electron main / Vite dev middleware) and is never inlined into the
// browser bundle. Returns the raw Anthropic /v1/messages response so existing
// call sites that read `resp.content[0].text` keep working unchanged.

export type ProxyMessage = { role: "user" | "assistant"; content: string };
export type ProxyResponse = { content: Array<{ type: string; text?: string }> };

/** UI gate for whether to attempt AI calls. Defaults ON; set VITE_AI_ENABLED=0
 *  to hard-disable. This is a non-secret flag — the real key stays server-side. */
export const aiEnabled =
  ((import.meta as { env?: Record<string, string> }).env?.VITE_AI_ENABLED ?? "1") !== "0";

export type ProxyBody = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ProxyMessage[];
};

async function failed(res: Response): Promise<Error> {
  if (res.status === 503) {
    return new Error("Kein API-Schlüssel auf dem Server — ANTHROPIC_API_KEY in .env setzen.");
  }
  const detail = await res.text().catch(() => "");
  return new Error(`KI-Proxy ${res.status}: ${detail.slice(0, 160)}`);
}

export async function anthropicMessages(body: ProxyBody): Promise<ProxyResponse> {
  const res = await fetch("/api/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failed(res);
  return (await res.json()) as ProxyResponse;
}

/** Streamt eine Antwort über denselben Proxy und gibt am Ende den ganzen Text.
 *
 *  Ersetzt `_ai.messages.stream()` aus dem Anthropic-SDK. Das SDK lief nur im
 *  Browser und brauchte dafür den Schlüssel im Bundle — genau das soll nicht
 *  sein. Hier kommt der Ereignisstrom vom eigenen Server, der Schlüssel bleibt
 *  dort.
 *
 *  `onText` bekommt jedes Textstück einzeln, damit die Antwort weiter Stück für
 *  Stück erscheint statt am Ende auf einen Schlag. */
export async function anthropicStream(
  body: ProxyBody,
  onText: (chunk: string) => void,
): Promise<string> {
  const res = await fetch("/api/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) throw await failed(res);
  if (!res.body) throw new Error("KI-Proxy liefert keinen Datenstrom.");

  type StreamEvent = {
    type?: string;
    delta?: { type?: string; text?: string };
    error?: { message?: string };
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Ein Ereignis kann zwischen zwei Paketen zerschnitten sein — die angefangene
  // Zeile wandert deshalb in den nächsten Durchlauf statt verworfen zu werden.
  let rest = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let ev: StreamEvent;
      try { ev = JSON.parse(raw) as StreamEvent; } catch { continue; }
      if (ev.type === "error") throw new Error(ev.error?.message ?? "KI-Fehler im Datenstrom");
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        full += ev.delta.text;
        onText(ev.delta.text);
      }
    }
  }
  return full;
}
