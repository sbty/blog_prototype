import { describe, expect, it } from "vitest";
import { assertNoDuplicateDrafts } from "../services/draftAuditValidation.js";

describe("assertNoDuplicateDrafts", () => {
  it("accepts zero or one matching draft", () => {
    expect(assertNoDuplicateDrafts({ title: "title", editUrls: [], count: 0 }).count).toBe(0);
    expect(
      assertNoDuplicateDrafts({
        title: "title",
        editUrls: ["https://www.blogger.com/blog/post/edit/1/2"],
        count: 1
      }).count
    ).toBe(1);
  });

  it("rejects multiple matching drafts", () => {
    expect(() =>
      assertNoDuplicateDrafts({
        title: "title",
        editUrls: [
          "https://www.blogger.com/blog/post/edit/1/2",
          "https://www.blogger.com/blog/post/edit/1/3"
        ],
        count: 2
      })
    ).toThrow("Duplicate Blogger drafts detected");
  });

  it("rejects inconsistent audit data", () => {
    expect(() =>
      assertNoDuplicateDrafts({
        title: "title",
        editUrls: ["https://www.blogger.com/blog/post/edit/1/2"],
        count: 2
      })
    ).toThrow("inconsistent results");
  });
});