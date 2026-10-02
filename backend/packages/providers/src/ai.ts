import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, VendorBillExtraction } from "@cutz/types";

const MODEL = process.env.AI_MODEL ?? "claude-sonnet-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

async function openAiText(system: string, user: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_completion_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`openai_${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Anthropic-backed AI provider for campaign drafts and the inbox FAQ assistant.
 * The FAQ assistant returns null (hand off to a human) when it is not confident
 * or lacks the data to answer — never guesses about pricing/timing/location.
 */
export class AnthropicAIProvider implements AIProvider {
  private client: Anthropic | null;

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  async draft(prompt: string, context?: Record<string, unknown>): Promise<string> {
    const system =
      "You write short, friendly marketing copy for a salon. No emojis unless asked. " +
      "Keep it under 60 words and never invent prices or offers not in the context. " +
      "Return a draft only; a salon staff member must approve it before sending.";
    const user = `${prompt}\n\nContext: ${JSON.stringify(context ?? {})}`;
    if (!this.client) {
      const generated = await openAiText(system, user, 800);
      if (!generated) throw new Error("ai_provider_not_configured");
      return generated;
    }
    const msg = await this.client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }],
    });
    return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  }

  async answerFaq(question: string, kb: Record<string, unknown>): Promise<string | null> {
    const system =
      "You are a salon front-desk assistant. Answer ONLY from the provided knowledge base " +
      "(services, pricing, timings, location). If the answer is not clearly in the KB, reply " +
      "with exactly the token HANDOFF so a human can take over. Do not guess.";
    const user = `KB: ${JSON.stringify(kb)}\n\nQuestion: ${question}`;
    if (!this.client) {
      const generated = await openAiText(system, user, 400);
      if (!generated || generated === "HANDOFF" || generated.includes("HANDOFF")) return null;
      return generated;
    }
    const msg = await this.client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    return text === "HANDOFF" || text.includes("HANDOFF") ? null : text;
  }

  async extractVendorBill(input: { imageUrl: string }): Promise<VendorBillExtraction> {
    const empty: VendorBillExtraction = { vendorName: null, billNumber: null, billDate: null, totalMinor: null, confidence: 0, lines: [], warnings: ["AI provider is not configured; enter bill details manually."] };
    if (!this.client) return empty;

    const url = new URL(input.imageUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported_image_url");
    const allowedHosts = (process.env.OCR_IMAGE_HOSTS ?? "").split(",").map(host => host.trim()).filter(Boolean);
    if (allowedHosts.length && !allowedHosts.includes(url.hostname)) throw new Error("image_host_not_allowed");
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("image_download_failed");
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) throw new Error("unsupported_image_type");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error("image_too_large");

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: "Extract vendor bill data. Return JSON only. Money must be integer paise. Never invent unreadable values; use null and add a warning. Confidence is 0 to 1.",
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: bytes.toString("base64") } },
        { type: "text", text: 'Return {"vendorName":string|null,"billNumber":string|null,"billDate":"YYYY-MM-DD"|null,"totalMinor":integer|null,"confidence":number,"lines":[{"description":string,"qty":integer,"unitMinor":integer,"amountMinor":integer}],"warnings":string[]}.' },
      ] }],
    });
    const raw = message.content.filter(block => block.type === "text").map(block => (block as { text: string }).text).join("").trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    try {
      const parsed = JSON.parse(raw) as VendorBillExtraction;
      return { ...empty, ...parsed, confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)), lines: Array.isArray(parsed.lines) ? parsed.lines : [], warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [] };
    } catch {
      return { ...empty, warnings: ["The AI response could not be parsed. Review the bill manually."] };
    }
  }
}
