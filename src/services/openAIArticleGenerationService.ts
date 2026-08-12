import type { AppConfig } from "../config/env.js";
import { generatedArticleResponsesSchema } from "../domain/articleGeneration.js";
import {
  articleGenerationPackageSchema,
  type ArticleGenerationPackage
} from "./articleGenerationPackageService.js";

// Five times the documented 2026-08-13 prices ($0.20 input / $1.20 output per MTok).
// This is an application-side safety estimate, not a replacement for project spend limits.
const LUNA_SAFETY_INPUT_USD_PER_MILLION_TOKENS = 1;
const LUNA_SAFETY_OUTPUT_USD_PER_MILLION_TOKENS = 6;

const generatedArticlesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "items"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "article", "sourceUrlsUsed"],
        properties: {
          requestId: { type: "string" },
          article: {
            type: "object",
            additionalProperties: false,
            required: [
              "title",
              "html",
              "labels",
              "searchDescription",
              "slug",
              "scheduledAt",
              "imagePath"
            ],
            properties: {
              title: { type: "string" },
              html: { type: "string" },
              labels: { type: "array", items: { type: "string" } },
              searchDescription: { type: "string" },
              slug: { type: "string" },
              scheduledAt: { type: ["string", "null"] },
              imagePath: { type: ["string", "null"] }
            }
          },
          sourceUrlsUsed: { type: "array", minItems: 1, items: { type: "string" } }
        }
      }
    }
  }
} as const;

interface OpenAIResponse {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string };
}

export interface OpenAIGenerationEstimate {
  model: "gpt-5.6-luna";
  requestCount: number;
  inputBytes: number;
  maxOutputTokens: number;
  maximumCostCents: number;
  pricingSafetyMultiplier: 5;
}

type GenerationConfig = Pick<
  AppConfig,
  | "ENABLE_ARTICLE_GENERATION"
  | "OPENAI_API_KEY"
  | "OPENAI_TEXT_MODEL"
  | "OPENAI_MAX_GENERATION_REQUESTS"
  | "OPENAI_MAX_INPUT_BYTES"
  | "OPENAI_MAX_OUTPUT_TOKENS"
  | "OPENAI_MAX_COST_CENTS"
  | "OPENAI_REQUEST_TIMEOUT_MS"
>;

type FetchLike = typeof fetch;

function buildPrompt(generationPackage: ArticleGenerationPackage): string {
  return [
    "Create every requested article and return only the required structured response.",
    "Follow each editorial profile, brief, output contract, requested language, and target length.",
    "Do not add active HTML, scripts, forms, event handlers, or javascript URLs.",
    "Preserve requestId, slug, scheduledAt, and source URLs exactly.",
    "sourceUrlsUsed must contain every source URL from the corresponding brief exactly once.",
    "The source URLs are provenance identifiers supplied by the caller; do not claim that you opened them.",
    JSON.stringify(generationPackage)
  ].join("\n");
}

function extractOutputText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || content.refusal) {
        throw new Error("OpenAI generation was refused");
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI response did not contain structured output text");
}

function normalizeNullableArticleFields(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const root = value as { items?: unknown[] };
  return {
    ...root,
    items: root.items?.map((item) => {
      if (!item || typeof item !== "object") return item;
      const typedItem = item as { article?: Record<string, unknown> };
      const article = { ...typedItem.article };
      if (article.scheduledAt === null) delete article.scheduledAt;
      if (article.imagePath === null) delete article.imagePath;
      return { ...typedItem, article };
    })
  };
}

function normalizedUrls(urls: string[]): Set<string> {
  return new Set(urls.map((url) => new URL(url).href));
}

function assertResponseMatchesPackage(
  responses: ReturnType<typeof generatedArticleResponsesSchema.parse>,
  generationPackage: ArticleGenerationPackage
): void {
  if (responses.items.length !== generationPackage.requests.length) {
    throw new Error("OpenAI response count does not match the generation package");
  }
  const byId = new Map(responses.items.map((item) => [item.requestId, item]));
  for (const request of generationPackage.requests) {
    const response = byId.get(request.requestId);
    if (!response) throw new Error(`OpenAI response is missing requestId ${request.requestId}`);
    if (response.article.slug !== request.outputContract.slug) {
      throw new Error(`OpenAI response changed slug for ${request.requestId}`);
    }
    if (response.article.scheduledAt !== request.outputContract.scheduledAt) {
      throw new Error(`OpenAI response changed scheduledAt for ${request.requestId}`);
    }
    const expectedSources = normalizedUrls(request.brief.sourceUrls);
    const actualSources = normalizedUrls(response.sourceUrlsUsed);
    if (
      expectedSources.size !== actualSources.size ||
      [...expectedSources].some((url) => !actualSources.has(url))
    ) {
      throw new Error(`OpenAI response changed source URLs for ${request.requestId}`);
    }
  }
}

export class OpenAIArticleGenerationService {
  constructor(
    private readonly config: GenerationConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  estimate(input: unknown): {
    package: ArticleGenerationPackage;
    estimate: OpenAIGenerationEstimate;
  } {
    if (this.config.OPENAI_TEXT_MODEL !== "gpt-5.6-luna") {
      throw new Error("OpenAI article generation only allows gpt-5.6-luna");
    }
    const generationPackage = articleGenerationPackageSchema.parse(input);
    const prompt = buildPrompt(generationPackage);
    const inputBytes = Buffer.byteLength(prompt, "utf8");
    const maximumCostCents = Math.ceil(
      ((inputBytes * LUNA_SAFETY_INPUT_USD_PER_MILLION_TOKENS +
        this.config.OPENAI_MAX_OUTPUT_TOKENS * LUNA_SAFETY_OUTPUT_USD_PER_MILLION_TOKENS) /
        1_000_000) *
        100
    );
    const estimate: OpenAIGenerationEstimate = {
      model: "gpt-5.6-luna",
      requestCount: generationPackage.requests.length,
      inputBytes,
      maxOutputTokens: this.config.OPENAI_MAX_OUTPUT_TOKENS,
      maximumCostCents,
      pricingSafetyMultiplier: 5
    };
    this.assertWithinLimits(estimate);
    return { package: generationPackage, estimate };
  }

  async execute(input: unknown, confirmedMaximumCostCents: number) {
    const preflight = this.estimate(input);
    if (!this.config.ENABLE_ARTICLE_GENERATION) {
      throw new Error("OpenAI article generation requires ENABLE_ARTICLE_GENERATION=true");
    }
    if (!this.config.OPENAI_API_KEY) {
      throw new Error("OpenAI article generation requires OPENAI_API_KEY");
    }
    if (confirmedMaximumCostCents !== preflight.estimate.maximumCostCents) {
      throw new Error(
        `Cost confirmation must exactly match ${preflight.estimate.maximumCostCents} cents`
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.OPENAI_REQUEST_TIMEOUT_MS);
    let apiResponse: Response;
    try {
      apiResponse = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.OPENAI_TEXT_MODEL,
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: this.config.OPENAI_MAX_OUTPUT_TOKENS,
          input: buildPrompt(preflight.package),
          text: {
            format: {
              type: "json_schema",
              name: "generated_article_responses",
              strict: true,
              schema: generatedArticlesJsonSchema
            }
          }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const response = (await apiResponse.json()) as OpenAIResponse;
    if (!apiResponse.ok) {
      throw new Error(`OpenAI generation failed with HTTP ${apiResponse.status}`);
    }
    if (response.status && response.status !== "completed") {
      throw new Error(`OpenAI generation did not complete: ${response.status}`);
    }
    const parsed = JSON.parse(extractOutputText(response)) as unknown;
    const responses = generatedArticleResponsesSchema.parse(normalizeNullableArticleFields(parsed));
    assertResponseMatchesPackage(responses, preflight.package);
    return {
      responses,
      estimate: preflight.estimate,
      responseId: response.id ?? null
    };
  }

  private assertWithinLimits(estimate: OpenAIGenerationEstimate): void {
    if (estimate.requestCount > this.config.OPENAI_MAX_GENERATION_REQUESTS) {
      throw new Error(
        `Generation package contains ${estimate.requestCount} requests; limit is ${this.config.OPENAI_MAX_GENERATION_REQUESTS}`
      );
    }
    if (estimate.inputBytes > this.config.OPENAI_MAX_INPUT_BYTES) {
      throw new Error(
        `Generation input is ${estimate.inputBytes} bytes; limit is ${this.config.OPENAI_MAX_INPUT_BYTES}`
      );
    }
    if (estimate.maximumCostCents > this.config.OPENAI_MAX_COST_CENTS) {
      throw new Error(
        `Estimated maximum cost is ${estimate.maximumCostCents} cents; limit is ${this.config.OPENAI_MAX_COST_CENTS}`
      );
    }
  }
}
