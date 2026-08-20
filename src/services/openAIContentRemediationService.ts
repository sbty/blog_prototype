import type { AppConfig } from "../config/env.js";
import {
  contentRemediationResponsesSchema,
  type ContentRemediationResponses
} from "./contentRemediationImportService.js";
import {
  contentRemediationPackageSchema,
  type ContentRemediationPackage
} from "./contentRemediationPackageService.js";

const INPUT_USD_PER_MILLION_TOKENS = 1;
const OUTPUT_USD_PER_MILLION_TOKENS = 6;

const responseSchema = {
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
        required: ["remediationId", "article", "sourceUrlsUsed"],
        properties: {
          remediationId: { type: "string" },
          article: {
            type: "object",
            additionalProperties: false,
            required: ["title", "html", "labels", "searchDescription", "slug"],
            properties: {
              title: { type: "string" },
              html: { type: "string" },
              labels: { type: "array", items: { type: "string" } },
              searchDescription: { type: "string" },
              slug: { type: "string" }
            }
          },
          sourceUrlsUsed: { type: "array", minItems: 1, items: { type: "string" } }
        }
      }
    }
  }
} as const;

type Config = Pick<
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

export interface OpenAIRemediationEstimate {
  model: "gpt-5.6-luna";
  requestCount: number;
  inputBytes: number;
  maxOutputTokens: number;
  maximumCostCents: number;
  pricingSafetyMultiplier: 5;
}

function prompt(remediationPackage: ContentRemediationPackage): string {
  return [
    "Return a complete corrected replacement for every remediation request as the required structured response.",
    "Resolve every audit issue. Preserve each remediationId and slug exactly.",
    "Use every provided source URL exactly once in sourceUrlsUsed and cite it in the article as an HTTPS link.",
    "Do not invent sources, use tools, add active HTML, or include image paths or scheduling data.",
    JSON.stringify(remediationPackage)
  ].join("\n");
}

function sameUrls(expected: string[], actual: string[]): boolean {
  const normalize = (urls: string[]) => new Set(urls.map((url) => new URL(url).href));
  const left = normalize(expected);
  const right = normalize(actual);
  return left.size === right.size && [...left].every((url) => right.has(url));
}

function visibleTextLength(html: string): number {
  return Array.from(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, "")
  ).length;
}

function assertMatchesPackage(
  responses: ContentRemediationResponses,
  remediationPackage: ContentRemediationPackage
): void {
  if (responses.items.length !== remediationPackage.requests.length) {
    throw new Error("OpenAI remediation response count does not match the package");
  }
  const byId = new Map(responses.items.map((item) => [item.remediationId, item]));
  for (const request of remediationPackage.requests) {
    const response = byId.get(request.remediationId);
    if (!response)
      throw new Error(`OpenAI remediation response is missing ${request.remediationId}`);
    if (response.article.slug !== request.currentArticle.slug) {
      throw new Error(`OpenAI remediation response changed slug for ${request.remediationId}`);
    }
    if (!sameUrls(request.provenance.sourceUrls, response.sourceUrlsUsed)) {
      throw new Error(
        `OpenAI remediation response changed source URLs for ${request.remediationId}`
      );
    }
    const textLength = visibleTextLength(response.article.html);
    if (
      textLength < request.editorialProfile.targetLength.min ||
      textLength > request.editorialProfile.targetLength.max
    ) {
      throw new Error(
        `OpenAI remediation response ${request.remediationId} has text length ${textLength} outside ${request.editorialProfile.targetLength.min}-${request.editorialProfile.targetLength.max}`
      );
    }
    for (const sourceUrl of request.provenance.sourceUrls) {
      if (!response.article.html.includes(sourceUrl)) {
        throw new Error(
          `OpenAI remediation response ${request.remediationId} does not cite ${sourceUrl}`
        );
      }
    }
  }
}

function extractOutputText(response: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}): string {
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || content.refusal) {
        throw new Error("OpenAI content remediation was refused");
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI content remediation did not contain structured output text");
}

export class OpenAIContentRemediationService {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  estimate(input: unknown): {
    package: ContentRemediationPackage;
    estimate: OpenAIRemediationEstimate;
  } {
    if (this.config.OPENAI_TEXT_MODEL !== "gpt-5.6-luna") {
      throw new Error("OpenAI content remediation only allows gpt-5.6-luna");
    }
    const remediationPackage = contentRemediationPackageSchema.parse(input);
    if (remediationPackage.requests.some((request) => request.provenance.requiresSourceResearch)) {
      throw new Error(
        "OpenAI content remediation requires provenance source URLs; source research is not enabled"
      );
    }
    const inputBytes = Buffer.byteLength(prompt(remediationPackage), "utf8");
    const maximumCostCents = Math.ceil(
      ((inputBytes * INPUT_USD_PER_MILLION_TOKENS +
        this.config.OPENAI_MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION_TOKENS) /
        1_000_000) *
        100
    );
    const estimate: OpenAIRemediationEstimate = {
      model: "gpt-5.6-luna",
      requestCount: remediationPackage.requests.length,
      inputBytes,
      maxOutputTokens: this.config.OPENAI_MAX_OUTPUT_TOKENS,
      maximumCostCents,
      pricingSafetyMultiplier: 5
    };
    if (estimate.requestCount > this.config.OPENAI_MAX_GENERATION_REQUESTS)
      throw new Error(
        `Remediation package contains ${estimate.requestCount} requests; limit is ${this.config.OPENAI_MAX_GENERATION_REQUESTS}`
      );
    if (estimate.inputBytes > this.config.OPENAI_MAX_INPUT_BYTES)
      throw new Error(
        `Remediation input is ${estimate.inputBytes} bytes; limit is ${this.config.OPENAI_MAX_INPUT_BYTES}`
      );
    if (estimate.maximumCostCents > this.config.OPENAI_MAX_COST_CENTS)
      throw new Error(
        `Estimated maximum cost is ${estimate.maximumCostCents} cents; limit is ${this.config.OPENAI_MAX_COST_CENTS}`
      );
    return { package: remediationPackage, estimate };
  }

  async execute(input: unknown, confirmedMaximumCostCents: number) {
    const preflight = this.estimate(input);
    if (!this.config.ENABLE_ARTICLE_GENERATION)
      throw new Error("OpenAI content remediation requires ENABLE_ARTICLE_GENERATION=true");
    if (!this.config.OPENAI_API_KEY)
      throw new Error("OpenAI content remediation requires OPENAI_API_KEY");
    if (confirmedMaximumCostCents !== preflight.estimate.maximumCostCents)
      throw new Error(
        `Cost confirmation must exactly match ${preflight.estimate.maximumCostCents} cents`
      );
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
          input: prompt(preflight.package),
          text: {
            format: {
              type: "json_schema",
              name: "content_remediation_responses",
              strict: true,
              schema: responseSchema
            }
          }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = (await apiResponse.json()) as {
      id?: string;
      status?: string;
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    };
    if (!apiResponse.ok)
      throw new Error(`OpenAI content remediation failed with HTTP ${apiResponse.status}`);
    if (raw.status && raw.status !== "completed")
      throw new Error(`OpenAI content remediation did not complete: ${raw.status}`);
    const responses = contentRemediationResponsesSchema.parse(
      JSON.parse(extractOutputText(raw)) as unknown
    );
    assertMatchesPackage(responses, preflight.package);
    return { responses, estimate: preflight.estimate, responseId: raw.id ?? null };
  }
}
