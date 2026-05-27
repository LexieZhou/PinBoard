// Thin wrapper around the TritonAI chat-completions endpoint. The gateway is
// OpenAI-compatible (litellm under the hood), so the same payload shape works
// for text-only models (gpt-oss-120b) and vision-capable models (claude-sonnet)
// alike — litellm translates `image_url` parts into each provider's native
// vision format. Keeping this client model-agnostic lets `triton.ts` pick the
// model per call without duplicating fetch/auth/error-handling code.

const TRITON_BASE = "https://tritonai-api.ucsd.edu/v1";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

type ChatCompletionResponse = {
  choices: Array<{ message: { content: string } }>;
};

export class LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = TRITON_BASE,
  ) {
    if (!apiKey) throw new Error("Missing TritonAI API key");
  }

  async chat(opts: ChatOptions): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        messages: opts.messages,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`TritonAI ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content ?? "";
  }
}
