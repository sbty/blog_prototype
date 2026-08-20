import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import { OpenAIArticleGenerationService } from "../services/openAIArticleGenerationService.js";
import { OpenAIContentRemediationService } from "../services/openAIContentRemediationService.js";

const generationPackage = {
  schemaVersion: 1,
  requests: [
    {
      requestId: "request-one",
      editorialProfile: {
        blogKey: "compatibility",
        displayName: "Compatibility",
        language: "en",
        targetCountry: "US",
        primaryTheme: "Device compatibility",
        targetAudience: ["Buyers"],
        topicClusters: ["USB-C"],
        excludedTopics: ["unsafe modifications"],
        targetLength: { min: 1000, max: 2000 }
      },
      brief: {
        topic: "USB-C compatibility",
        searchIntent: "Check compatibility",
        requiredPoints: ["Explain power negotiation"],
        sourceUrls: ["https://example.com/source"]
      },
      outputContract: {
        slug: "usb-c-compatibility",
        requiredFields: ["title", "html", "labels", "searchDescription", "slug"],
        htmlRestrictions: [
          "script",
          "object",
          "embed",
          "form",
          "event handlers",
          "javascript URLs"
        ],
        responseFields: ["requestId", "article", "sourceUrlsUsed"]
      }
    }
  ]
};

function generatedOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    items: [
      {
        requestId: "request-one",
        article: {
          title: "USB-C compatibility",
          html: "<p>Check official specifications.</p>",
          labels: ["USB-C"],
          searchDescription: "How to check USB-C compatibility.",
          slug: "usb-c-compatibility",
          scheduledAt: null,
          imagePath: null,
          ...overrides
        },
        sourceUrlsUsed: ["https://example.com/source"]
      }
    ]
  });
}

function config(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    ENABLE_ARTICLE_GENERATION: "true",
    OPENAI_API_KEY: "test-key",
    OPENAI_MAX_COST_CENTS: "10",
    OPENAI_MAX_OUTPUT_TOKENS: "12000",
    ...overrides
  });
}

describe("OpenAIArticleGenerationService", () => {
  it("estimates a conservative bounded cost without calling the API", () => {
    const fetchMock = vi.fn();
    const result = new OpenAIArticleGenerationService(
      config(),
      fetchMock as unknown as typeof fetch
    ).estimate(generationPackage);

    expect(result.estimate).toMatchObject({
      model: "gpt-5.6-luna",
      requestCount: 1,
      maxOutputTokens: 12000,
      maximumCostCents: 8,
      pricingSafetyMultiplier: 5
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when disabled, uncredentialed, over budget, or unconfirmed", async () => {
    const fetchMock = vi.fn();
    await expect(
      new OpenAIArticleGenerationService(
        config({ ENABLE_ARTICLE_GENERATION: "false" }),
        fetchMock as unknown as typeof fetch
      ).execute(generationPackage, 8)
    ).rejects.toThrow("ENABLE_ARTICLE_GENERATION=true");
    await expect(
      new OpenAIArticleGenerationService(
        config({ OPENAI_API_KEY: "" }),
        fetchMock as unknown as typeof fetch
      ).execute(generationPackage, 8)
    ).rejects.toThrow("requires OPENAI_API_KEY");
    await expect(
      new OpenAIArticleGenerationService(config(), fetchMock as unknown as typeof fetch).execute(
        generationPackage,
        1
      )
    ).rejects.toThrow("exactly match 8 cents");
    expect(() =>
      new OpenAIArticleGenerationService(
        config({ OPENAI_TEXT_MODEL: "legacy-model" }),
        fetchMock as unknown as typeof fetch
      ).estimate(generationPackage)
    ).toThrow("only allows gpt-5.6-luna");
    expect(() =>
      new OpenAIArticleGenerationService(
        config({ OPENAI_MAX_COST_CENTS: "1" }),
        fetchMock as unknown as typeof fetch
      ).estimate(generationPackage)
    ).toThrow("Estimated maximum cost is 8 cents; limit is 1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses Responses structured output with storage disabled and validates the result", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "resp_test", status: "completed", output_text: generatedOutput() })
    );
    const result = await new OpenAIArticleGenerationService(
      config(),
      fetchMock as unknown as typeof fetch
    ).execute(generationPackage, 8);

    expect(result.responses.items[0].article).not.toHaveProperty("scheduledAt");
    expect(result.responseId).toBe("resp_test");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 12000,
      text: { format: { type: "json_schema", strict: true } }
    });
    expect(request).not.toHaveProperty("tools");
  });

  it("rejects HTTP errors, refusals, and responses that change the contract", async () => {
    const httpFailure = vi.fn(async () =>
      Response.json({ error: { message: "secret details" } }, { status: 429 })
    );
    await expect(
      new OpenAIArticleGenerationService(config(), httpFailure as unknown as typeof fetch).execute(
        generationPackage,
        8
      )
    ).rejects.toThrow("HTTP 429");

    const refusal = vi.fn(async () =>
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }]
      })
    );
    await expect(
      new OpenAIArticleGenerationService(config(), refusal as unknown as typeof fetch).execute(
        generationPackage,
        8
      )
    ).rejects.toThrow("was refused");

    const changedSlug = vi.fn(async () =>
      Response.json({ status: "completed", output_text: generatedOutput({ slug: "changed" }) })
    );
    await expect(
      new OpenAIArticleGenerationService(config(), changedSlug as unknown as typeof fetch).execute(
        generationPackage,
        8
      )
    ).rejects.toThrow("changed slug");
  });
});

describe("OpenAIContentRemediationService", () => {
  const remediationPackage = {
    schemaVersion: 1,
    requests: [
      {
        remediationId: "content-remediation-0001",
        sourceIndex: 0,
        blogKey: "one",
        editorialProfile: {
          displayName: "One",
          language: "en",
          targetCountry: "US",
          primaryTheme: "Guides",
          targetAudience: [],
          topicClusters: [],
          excludedTopics: [],
          targetLength: { min: 10, max: 1000 }
        },
        currentArticle: {
          title: "Original",
          html: "<p>Original</p>",
          labels: [],
          searchDescription: "Original",
          slug: "original"
        },
        provenance: { sourceUrls: ["https://example.com/source"], requiresSourceResearch: false },
        audit: {
          metrics: {
            textLength: 8,
            targetLengthMin: 10,
            targetLengthMax: 1000,
            sourceCount: 1,
            citedSourceCount: 1,
            labelCount: 0,
            imageBytes: 1
          },
          issues: [{ code: "TARGET_LENGTH", severity: "ERROR", message: "Short" }]
        },
        correctionRules: [
          "resolve every listed audit issue",
          "preserve the slug exactly",
          "preserve the article topic and search intent",
          "cite every provided source URL as an HTTPS link",
          "do not invent source URLs or unsupported claims",
          "return a complete replacement article"
        ],
        outputContract: {
          requiredFields: ["title", "html", "labels", "searchDescription", "slug"],
          responseFields: ["remediationId", "article", "sourceUrlsUsed"],
          preserveImagePathOutOfBand: true,
          preserveScheduledAtOutOfBand: true
        }
      }
    ]
  };
  it("uses a store-free structured response and preserves the remediation contract", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "resp_test",
        status: "completed",
        output_text: JSON.stringify({
          schemaVersion: 1,
          items: [
            {
              remediationId: "content-remediation-0001",
              article: {
                title: "Corrected",
                html: '<p><a href="https://example.com/source">Source</a></p>',
                labels: ["guide"],
                searchDescription: "Corrected",
                slug: "original"
              },
              sourceUrlsUsed: ["https://example.com/source"]
            }
          ]
        })
      })
    );
    const service = new OpenAIContentRemediationService(
      config(),
      fetchMock as unknown as typeof fetch
    );
    const estimate = service.estimate(remediationPackage);
    expect(fetchMock).not.toHaveBeenCalled();
    const result = await service.execute(remediationPackage, estimate.estimate.maximumCostCents);
    expect(result.responses.items[0].remediationId).toBe("content-remediation-0001");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(request).toMatchObject({
      store: false,
      text: { format: { type: "json_schema", strict: true } }
    });
    expect(request).not.toHaveProperty("tools");
  });
});
