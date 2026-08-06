import { describe, expect, it } from "vitest";
import {
  isPotentialMutationRequest,
  sanitizeRequestUrl
} from "../browser/dryRunNetworkGuard.js";

describe("sanitizeRequestUrl", () => {
  it("removes query parameters and fragments from audit output", () => {
    expect(
      sanitizeRequestUrl("https://www.blogger.com/api/save?token=secret#private")
    ).toBe("https://www.blogger.com/api/save");
  });

  it("removes URL user credentials from audit output", () => {
    expect(
      sanitizeRequestUrl("https://user:password@www.blogger.com/api/save")
    ).toBe("https://www.blogger.com/api/save");
  });

  it("redacts non-HTTP URLs and invalid values", () => {
    expect(sanitizeRequestUrl("data:text/plain,secret")).toBe("data://[redacted]");
    expect(sanitizeRequestUrl("not a url")).toBe("[invalid-url]");
  });
});
describe("dry-run network guard", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("allows read-only method %s", (method) => {
    expect(isPotentialMutationRequest(method)).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])(
    "blocks potential mutation method %s",
    (method) => {
      expect(isPotentialMutationRequest(method)).toBe(true);
    }
  );
});