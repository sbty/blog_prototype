import type { Locator, Page, Request, Response } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
  assertSuccessfulDraftSaveTransaction,
  createDraftSaveNetworkObserver,
  performDraftChangeWithRecognition,
  waitForExpectedPermalinkPreview,
  waitForDraftSaveCompletion
} from "../browser/bloggerDryRun.js";

function locator(options: { visible?: boolean; waitFor?: () => Promise<void> } = {}) {
  return {
    isVisible: vi.fn(async () => options.visible ?? false),
    waitFor: vi.fn(options.waitFor ?? (async () => undefined))
  } as unknown as Pick<Locator, "isVisible" | "waitFor">;
}

function page() {
  return {
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined)
  } as unknown as Pick<Page, "waitForLoadState" | "waitForTimeout">;
}

type NetworkEvent = "request" | "response" | "requestfailed";
type NetworkListener = (value: Request | Response) => void;

function networkPage() {
  const listeners = new Map<NetworkEvent, Set<NetworkListener>>();
  const eventPage = {
    on: vi.fn((event: NetworkEvent, listener: NetworkListener) => {
      const current = listeners.get(event) ?? new Set<NetworkListener>();
      current.add(listener);
      listeners.set(event, current);
      return eventPage;
    }),
    off: vi.fn((event: NetworkEvent, listener: NetworkListener) => {
      listeners.get(event)?.delete(listener);
      return eventPage;
    })
  } as unknown as Pick<Page, "on" | "off">;

  return {
    page: eventPage,
    emit(event: NetworkEvent, value: Request | Response) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    }
  };
}

function request(method: string, url: string, body: string | null = null): Request {
  return { method: () => method, url: () => url, postData: () => body } as Request;
}

function response(source: Request, status: number, body = ""): Response {
  return { request: () => source, status: () => status, text: async () => body } as Response;
}

function previewPage(candidate: Response) {
  return {
    waitForResponse: vi.fn(async (predicate: (value: Response) => boolean) => {
      if (!predicate(candidate)) throw new Error("No matching preview response");
      return candidate;
    })
  } as unknown as Pick<Page, "waitForResponse">;
}

describe("createDraftSaveNetworkObserver", () => {
  const endpoint = "https://www.blogger.com/_/BloggerUi/data/batchexecute";
  const slug = "required-permalink";
  const requestBody = (rpcId: string, payload: string) =>
    new URLSearchParams({
      "f.req": JSON.stringify([[[rpcId, payload, null, "generic"]]])
    }).toString();
  const successBody = (rpcId: string, payload = '{"saved":true}') =>
    `)]}'\n\n42\n${JSON.stringify([["wrb.fr", rpcId, payload, null, null, null, "generic"]])}`;

  it("records privacy-safe derived evidence for a slug-bearing application success", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const saveRequest = request(
      "post",
      `${endpoint}?token=secret#private`,
      requestBody("rpcSave", JSON.stringify({ permalink: slug }))
    );

    const result = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit(
        "response",
        response(saveRequest, 200, successBody("rpcSave", `{"url":"/2026/09/${slug}.html"}`))
      );
      return "clicked";
    });

    expect(result.value).toBe("clicked");
    expect(result.evidence).toMatchObject({
      terminalStatus: "SUCCESS",
      explicitSaveClickStartedAt: expect.any(String),
      postClickGraceMs: 2000,
      correlatedRequestOrdinal: 1,
      transactions: [
        {
          ordinal: 1,
          method: "POST",
          url: endpoint,
          rpcIds: ["rpcSave"],
          startedAfterExplicitSaveClick: true,
          exactSlugPresent: true,
          responseStatus: 200,
          applicationStatus: "SUCCESS",
          returnedPermalink: "EXPECTED_SLUG",
          terminalStatus: "SUCCESS"
        }
      ]
    });
    expect(result.evidence.expectedSlugSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.transactions[0]?.requestBodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.transactions[0]?.responseBodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.evidence)).not.toContain(slug);
    expect(JSON.stringify(result.evidence)).not.toContain("secret");
    expect(() => assertSuccessfulDraftSaveTransaction(result.evidence)).not.toThrow();
    observer.dispose();
  });

  it("correlates application status and permalink only with RPCs from the request", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const saveRequest = request("POST", endpoint, requestBody("rpcSave", JSON.stringify({ slug })));
    const mixedBody = `)]}'\n${JSON.stringify([
      ["wrb.fr", "rpcNoise", `{"url":"/2026/09/${slug}.html"}`, null, null, null, "generic"],
      ["wrb.fr", "rpcSave", null, null, null, [3, "rejected"], "generic"]
    ])}`;

    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit("response", response(saveRequest, 200, mixedBody));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "APPLICATION_ERROR",
      correlatedRequestOrdinal: null,
      transactions: [
        {
          applicationStatus: "ERROR",
          returnedPermalink: "NOT_OBSERVED"
        }
      ]
    });
    observer.dispose();
  });

  it("fails closed when the request RPC IDs cannot be parsed", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const saveRequest = request("POST", endpoint, JSON.stringify({ slug }));

    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit(
        "response",
        response(
          saveRequest,
          200,
          successBody("rpcUncorrelated", `{"url":"/2026/09/${slug}.html"}`)
        )
      );
    });

    expect(evidence).toMatchObject({
      terminalStatus: "APPLICATION_UNCONFIRMED",
      correlatedRequestOrdinal: null,
      transactions: [
        {
          rpcIds: [],
          exactSlugPresent: true,
          applicationStatus: "UNKNOWN",
          returnedPermalink: "NOT_OBSERVED"
        }
      ]
    });
    expect(() => assertSuccessfulDraftSaveTransaction(evidence)).toThrow(
      "Blogger draft Save action did not produce a successful terminal network transaction"
    );
    observer.dispose();
  });

  it("tracks and correlates all concurrent matching RPCs instead of the first one", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const unrelated = request("POST", endpoint, requestBody("rpcNoise", '{"autosave":true}'));
    const correlated = request(
      "POST",
      endpoint,
      requestBody("rpcPermalink", JSON.stringify({ slug }))
    );
    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", unrelated);
      events.emit("request", correlated);
      events.emit("response", response(correlated, 200, successBody("rpcPermalink")));
      events.emit("response", response(unrelated, 200, successBody("rpcNoise")));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "SUCCESS",
      correlatedRequestOrdinal: 2
    });
    expect(evidence.transactions).toHaveLength(2);
    expect(
      evidence.transactions.map(({ ordinal, rpcIds, exactSlugPresent }) => ({
        ordinal,
        rpcIds,
        exactSlugPresent
      }))
    ).toEqual([
      { ordinal: 1, rpcIds: ["rpcNoise"], exactSlugPresent: false },
      { ordinal: 2, rpcIds: ["rpcPermalink"], exactSlugPresent: true }
    ]);
    observer.dispose();
  });

  it("keeps observing until the guarded action completes after an earlier request is quiescent", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const earlySave = request("POST", endpoint, requestBody("rpcEarly", '{"autosave":true}'));
    const permalinkSave = request(
      "POST",
      endpoint,
      requestBody("rpcPermalink", JSON.stringify({ slug }))
    );

    const { evidence } = await observer.run(async () => {
      events.emit("request", earlySave);
      events.emit("response", response(earlySave, 200, successBody("rpcEarly")));
      await new Promise((resolve) => setTimeout(resolve, 5));
      observer.markExplicitSaveClick();
      events.emit("request", permalinkSave);
      events.emit("response", response(permalinkSave, 200, successBody("rpcPermalink")));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "SUCCESS",
      correlatedRequestOrdinal: 2,
      transactions: [
        { ordinal: 1, startedAfterExplicitSaveClick: false },
        { ordinal: 2, startedAfterExplicitSaveClick: true }
      ]
    });
    expect(evidence.transactions.map(({ rpcIds }) => rpcIds)).toEqual([
      ["rpcEarly"],
      ["rpcPermalink"]
    ]);
    observer.dispose();
  });

  it("keeps the post-click window open for a delayed Save transaction", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, {
      quiescenceMs: 0,
      postClickGraceMs: 50
    });
    const previewRequest = request(
      "POST",
      endpoint,
      requestBody("rpcPreview", JSON.stringify({ slug }))
    );
    const delayedSaveRequest = request(
      "POST",
      endpoint,
      requestBody("rpcSave", JSON.stringify({ slug }))
    );

    const { evidence } = await observer.run(async () => {
      events.emit("request", previewRequest);
      events.emit("response", response(previewRequest, 200, successBody("rpcPreview")));
      observer.markExplicitSaveClick();
      setTimeout(() => {
        events.emit("request", delayedSaveRequest);
        events.emit("response", response(delayedSaveRequest, 200, successBody("rpcSave")));
      }, 10);
    });

    expect(evidence).toMatchObject({
      terminalStatus: "SUCCESS",
      postClickGraceMs: 50,
      correlatedRequestOrdinal: 2,
      transactions: [
        { startedAfterExplicitSaveClick: false },
        { startedAfterExplicitSaveClick: true, exactSlugPresent: true }
      ]
    });
    observer.dispose();
  });

  it("does not misclassify a delayed permalink-preview RPC as the explicit Save", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, {
      quiescenceMs: 0,
      postClickGraceMs: 0
    });
    const delayedPreview = request(
      "POST",
      endpoint,
      requestBody("L3WS8", JSON.stringify({ slug }))
    );

    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", delayedPreview);
      events.emit(
        "response",
        response(delayedPreview, 200, successBody("L3WS8", `{"url":"/2026/09/${slug}.html"}`))
      );
    });

    expect(evidence).toMatchObject({
      terminalStatus: "APPLICATION_UNCONFIRMED",
      correlatedRequestOrdinal: null,
      transactions: [
        {
          rpcIds: ["L3WS8"],
          startedAfterExplicitSaveClick: true,
          exactSlugPresent: true,
          applicationStatus: "SUCCESS",
          returnedPermalink: "EXPECTED_SLUG"
        }
      ]
    });
    expect(() => assertSuccessfulDraftSaveTransaction(evidence)).toThrow(
      "Blogger draft Save action did not produce a successful terminal network transaction"
    );
    observer.dispose();
  });

  it("fails closed for an HTTP-200 application error", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, {
      quiescenceMs: 0,
      postClickGraceMs: 0
    });
    const saveRequest = request("POST", endpoint, requestBody("rpcSave", JSON.stringify({ slug })));
    const errorBody = JSON.stringify([
      ["wrb.fr", "rpcSave", null, null, null, [3, "rejected"], "generic"]
    ]);
    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit("response", response(saveRequest, 200, errorBody));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "APPLICATION_ERROR",
      correlatedRequestOrdinal: null,
      transactions: [{ responseStatus: 200, applicationStatus: "ERROR" }]
    });
    expect(() => assertSuccessfulDraftSaveTransaction(evidence)).toThrow(
      "Blogger draft Save action did not produce a successful terminal network transaction"
    );
    observer.dispose();
  });

  it("fails closed when a successful RPC omits the required slug", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const saveRequest = request("POST", endpoint, requestBody("rpcSave", '{"title":"unchanged"}'));
    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit("response", response(saveRequest, 200, successBody("rpcSave")));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "SLUG_NOT_OBSERVED",
      correlatedRequestOrdinal: null,
      transactions: [{ exactSlugPresent: false, applicationStatus: "SUCCESS" }]
    });
    expect(() => assertSuccessfulDraftSaveTransaction(evidence)).toThrow(
      "Blogger draft Save action did not produce a successful terminal network transaction"
    );
    observer.dispose();
  });

  it("ignores read-only and non-Save traffic and reports no Save transaction", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", request("GET", "https://www.blogger.com/blog/post/edit/1/2"));
      events.emit("request", request("POST", "https://accounts.google.com/telemetry"));
      events.emit("request", request("POST", "https://www.blogger.com/background-autosave"));
      events.emit("request", request("POST", "https://www.blogger.com/_/BloggerUi/browserinfo"));
    }, 1);

    expect(evidence).toMatchObject({
      terminalStatus: "NO_TRANSACTION",
      correlatedRequestOrdinal: null,
      transactions: []
    });
    observer.dispose();
  });

  it("records request failure and timeout without failure details or raw bodies", async () => {
    const failedEvents = networkPage();
    const failedObserver = createDraftSaveNetworkObserver(failedEvents.page, slug, {
      quiescenceMs: 0
    });
    const failedRequest = request(
      "POST",
      endpoint,
      requestBody("rpcSave", JSON.stringify({ slug }))
    );
    const failed = await failedObserver.run(async () => {
      failedObserver.markExplicitSaveClick();
      failedEvents.emit("request", failedRequest);
      failedEvents.emit("requestfailed", failedRequest);
    });
    expect(failed.evidence).toMatchObject({
      terminalStatus: "REQUEST_FAILED",
      transactions: [{ terminalStatus: "REQUEST_FAILED", responseStatus: null }]
    });
    expect(failed.evidence.transactions[0]).not.toHaveProperty("failure");
    failedObserver.dispose();

    const timedOutEvents = networkPage();
    const timedOutObserver = createDraftSaveNetworkObserver(timedOutEvents.page, slug, {
      quiescenceMs: 0
    });
    const timedOutRequest = request(
      "POST",
      endpoint,
      requestBody("rpcSave", JSON.stringify({ slug }))
    );
    const timedOut = await timedOutObserver.run(async () => {
      timedOutObserver.markExplicitSaveClick();
      timedOutEvents.emit("request", timedOutRequest);
    }, 1);
    expect(timedOut.evidence).toMatchObject({
      terminalStatus: "TIMED_OUT",
      transactions: [{ terminalStatus: "TIMED_OUT", completedAt: null }]
    });
    timedOutObserver.dispose();
  });

  it("fails closed with safe terminal evidence for an HTTP error", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const saveRequest = request(
      "POST",
      "https://www.blogger.com/blog/post/edit/1/2?auth=secret",
      JSON.stringify({ slug })
    );
    const { evidence } = await observer.run(async () => {
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit("response", response(saveRequest, 503, '{"error":"private detail"}'));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "HTTP_ERROR",
      transactions: [
        {
          method: "POST",
          url: "https://www.blogger.com/blog/post/edit/1/2",
          responseStatus: 503,
          applicationStatus: "NOT_APPLICABLE"
        }
      ]
    });
    expect(evidence.transactions[0]?.responseBodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain("private detail");
    observer.dispose();
  });

  it("does not accept a pre-click permalink preview RPC as explicit Save success", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, { quiescenceMs: 0 });
    const previewRequest = request(
      "POST",
      endpoint,
      requestBody("L3WS8", JSON.stringify({ slug }))
    );
    const saveRequest = request("POST", endpoint, requestBody("Me2Pwc", '{"save":true}'));

    const { evidence } = await observer.run(async () => {
      events.emit("request", previewRequest);
      events.emit(
        "response",
        response(previewRequest, 200, successBody("L3WS8", `{"url":"/2026/09/${slug}.html"}`))
      );
      observer.markExplicitSaveClick();
      events.emit("request", saveRequest);
      events.emit("response", response(saveRequest, 200, successBody("Me2Pwc")));
    });

    expect(evidence).toMatchObject({
      terminalStatus: "SLUG_NOT_OBSERVED",
      correlatedRequestOrdinal: null,
      transactions: [
        {
          rpcIds: ["L3WS8"],
          startedAfterExplicitSaveClick: false,
          exactSlugPresent: true,
          returnedPermalink: "EXPECTED_SLUG"
        },
        {
          rpcIds: ["Me2Pwc"],
          startedAfterExplicitSaveClick: true,
          exactSlugPresent: false
        }
      ]
    });
    expect(() => assertSuccessfulDraftSaveTransaction(evidence)).toThrow(
      "Blogger draft Save action did not produce a successful terminal network transaction"
    );
    observer.dispose();
  });

  it("distinguishes a completed pre-click preview from a missing post-click transaction", async () => {
    const events = networkPage();
    const observer = createDraftSaveNetworkObserver(events.page, slug, {
      quiescenceMs: 0,
      postClickGraceMs: 0
    });
    const previewRequest = request(
      "POST",
      endpoint,
      requestBody("L3WS8", JSON.stringify({ slug }))
    );

    const { evidence } = await observer.run(async () => {
      events.emit("request", previewRequest);
      events.emit(
        "response",
        response(previewRequest, 200, successBody("L3WS8", `{"url":"/2026/09/${slug}.html"}`))
      );
      observer.markExplicitSaveClick();
    });

    expect(evidence).toMatchObject({
      terminalStatus: "NO_POST_CLICK_TRANSACTION",
      correlatedRequestOrdinal: null,
      transactions: [
        {
          rpcIds: ["L3WS8"],
          startedAfterExplicitSaveClick: false,
          exactSlugPresent: true,
          applicationStatus: "SUCCESS"
        }
      ]
    });
    observer.dispose();
  });
});

describe("waitForExpectedPermalinkPreview", () => {
  const endpoint = "https://www.blogger.com/_/BloggerUi/data/batchexecute";
  const slug = "required-permalink";
  const requestBody = (rpcId: string, payload: string) =>
    new URLSearchParams({
      "f.req": JSON.stringify([[[rpcId, payload, null, "generic"]]])
    }).toString();
  const successBody = (rpcId: string, payload: string) =>
    `)]}'\\n\\n42\\n${JSON.stringify([["wrb.fr", rpcId, payload, null, null, null, "generic"]])}`;
  const validSuccessBody = (rpcId: string, payload: string) =>
    [
      ")]}'",
      "",
      "42",
      JSON.stringify([["wrb.fr", rpcId, payload, null, null, null, "generic"]])
    ].join(String.fromCharCode(10));

  it("requires the blurred slug-preview RPC to confirm the requested permalink before Save", async () => {
    const previewRequest = request(
      "POST",
      endpoint,
      requestBody("L3WS8", JSON.stringify({ slug }))
    );
    const page = previewPage(
      response(previewRequest, 200, validSuccessBody("L3WS8", `{"url":"/2026/09/${slug}.html"}`))
    );

    await expect(waitForExpectedPermalinkPreview(page, slug)).resolves.toBeUndefined();
    expect(page.waitForResponse).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
  });

  it("fails closed when the preview response does not return the requested permalink", async () => {
    const previewRequest = request(
      "POST",
      endpoint,
      requestBody("L3WS8", JSON.stringify({ slug }))
    );
    const page = previewPage(response(previewRequest, 200, successBody("L3WS8", "{}")));

    await expect(waitForExpectedPermalinkPreview(page, slug)).rejects.toThrow(
      "Blogger custom permalink preview did not confirm the requested slug"
    );
  });
});

describe("waitForDraftSaveCompletion", () => {
  it("accepts a normal post-click saved-indicator transition after the menu closes", async () => {
    const saveMenuItem = locator({ visible: false });
    const savedIndicator = locator({ visible: true });

    const result = await waitForDraftSaveCompletion({
      page: page(),
      saveMenuItem,
      savedIndicator,
      savedIndicatorVisibleBeforeClick: false,
      quiescenceMs: 25
    });

    expect(saveMenuItem.waitFor).toHaveBeenCalledWith({ state: "hidden", timeout: 10000 });
    expect(savedIndicator.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 30000 });
    expect(result).toMatchObject({
      savedIndicatorVisibleBeforeClick: false,
      savedIndicatorTransitionObserved: true,
      saveMenuClosed: true,
      quiescenceMs: 25
    });
  });

  it("does not reuse an indicator that was already visible before clicking Save", async () => {
    const savedIndicator = locator({ visible: true });

    const result = await waitForDraftSaveCompletion({
      page: page(),
      saveMenuItem: locator({ visible: false }),
      savedIndicator,
      savedIndicatorVisibleBeforeClick: true,
      quiescenceMs: 0
    });

    expect(savedIndicator.waitFor).not.toHaveBeenCalled();
    expect(result.savedIndicatorTransitionObserved).toBe(false);
  });

  it("fails closed when the Save menu does not close", async () => {
    const saveMenuItem = locator({
      visible: true,
      waitFor: async () => {
        throw new Error("timeout");
      }
    });

    await expect(
      waitForDraftSaveCompletion({
        page: page(),
        saveMenuItem,
        savedIndicator: locator(),
        savedIndicatorVisibleBeforeClick: true
      })
    ).rejects.toThrow("Blogger draft Save menu did not close after the save click");
  });
});

describe("performDraftChangeWithRecognition", () => {
  it("accepts a new hidden-to-visible transition when saved was already visible", async () => {
    const waits: string[] = [];
    const savedIndicator = {
      isVisible: vi.fn(async () => true),
      waitFor: vi.fn(async ({ state }: { state: string }) => {
        waits.push(state);
      })
    } as unknown as Pick<Locator, "isVisible" | "waitFor">;

    const result = await performDraftChangeWithRecognition({
      savedIndicator,
      mutate: async () => "slug"
    });

    expect(waits).toEqual(["hidden", "visible"]);
    expect(result.recognition).toEqual({
      savedIndicatorVisibleBeforeChange: true,
      savedIndicatorHiddenAfterChange: true,
      savedIndicatorVisibleAfterChange: true
    });
  });

  it("accepts a newly visible saved indicator when it was initially hidden", async () => {
    const savedIndicator = locator({ visible: false });
    const result = await performDraftChangeWithRecognition({
      savedIndicator,
      mutate: async () => "slug"
    });

    expect(savedIndicator.waitFor).toHaveBeenCalledTimes(1);
    expect(savedIndicator.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 15000 });
    expect(result.recognition.savedIndicatorVisibleBeforeChange).toBe(false);
  });

  it("stops before saving when a pre-visible indicator never hides", async () => {
    const savedIndicator = {
      isVisible: vi.fn(async () => true),
      waitFor: vi.fn(async ({ state }: { state: string }) => {
        if (state === "hidden") throw new Error("timeout");
      })
    } as unknown as Pick<Locator, "isVisible" | "waitFor">;

    await expect(
      performDraftChangeWithRecognition({ savedIndicator, mutate: async () => "slug" })
    ).rejects.toThrow("Blogger did not recognize the permalink edit as a new draft change");
  });
});
