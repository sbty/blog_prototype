import { describe, expect, it, vi } from "vitest";
import {
  clickDraftSaveButtonWithGuard,
  performDraftMutationWithGuard,
  requireDraftMutationGuard,
  uploadDraftImageWithGuard,
  validateDraftTitle
} from "../browser/bloggerDryRun.js";
import {
  performImageMutationWithGuard,
  requireImageMutationGuard
} from "../browser/bloggerImageUploader.js";

describe("clickDraftSaveButtonWithGuard", () => {
  it("runs the mutation guard immediately before clicking save", async () => {
    const order: string[] = [];
    const button = {
      getAttribute: vi.fn(async () => {
        order.push("attribute");
        return null;
      }),
      click: vi.fn(async () => {
        order.push("click");
      })
    };

    await expect(
      clickDraftSaveButtonWithGuard(button, async () => {
        order.push("guard");
      })
    ).resolves.toBe(true);
    expect(order).toEqual(["attribute", "guard", "click"]);
  });

  it("does not click save when the mutation guard fails", async () => {
    const button = {
      getAttribute: vi.fn(async () => null),
      click: vi.fn(async () => undefined)
    };

    await expect(
      clickDraftSaveButtonWithGuard(button, async () => {
        throw new Error("STOP requested");
      })
    ).rejects.toThrow("STOP requested");
    expect(button.click).not.toHaveBeenCalled();
  });

  it("does not guard or click when the save button is disabled", async () => {
    const guard = vi.fn(async () => undefined);
    const button = {
      getAttribute: vi.fn(async () => "true"),
      click: vi.fn(async () => undefined)
    };

    await expect(clickDraftSaveButtonWithGuard(button, guard)).resolves.toBe(false);
    expect(guard).not.toHaveBeenCalled();
    expect(button.click).not.toHaveBeenCalled();
  });
});
describe("uploadDraftImageWithGuard", () => {
  it("runs the mutation guard immediately before uploading", async () => {
    const order: string[] = [];
    const upload = vi.fn(async () => {
      order.push("upload");
      return { sourcePath: "image.png", sizeBytes: 10, insertedImageCount: 1 };
    });

    await uploadDraftImageWithGuard(async () => {
      order.push("guard");
    }, upload);
    expect(order).toEqual(["guard", "upload"]);
  });

  it("does not upload when the mutation guard fails", async () => {
    const upload = vi.fn(async () => ({
      sourcePath: "image.png",
      sizeBytes: 10,
      insertedImageCount: 1
    }));
    await expect(
      uploadDraftImageWithGuard(async () => {
        throw new Error("STOP requested");
      }, upload)
    ).rejects.toThrow("STOP requested");
    expect(upload).not.toHaveBeenCalled();
  });
});
describe("performImageMutationWithGuard", () => {
  it("does not perform an internal image mutation after STOP", async () => {
    const mutation = vi.fn(async () => undefined);
    await expect(
      performImageMutationWithGuard(async () => {
        throw new Error("STOP requested");
      }, mutation)
    ).rejects.toThrow("STOP requested");
    expect(mutation).not.toHaveBeenCalled();
  });
});
describe("performDraftMutationWithGuard", () => {
  it("does not perform an editor mutation after STOP", async () => {
    const mutation = vi.fn(async () => undefined);
    await expect(
      performDraftMutationWithGuard(async () => {
        throw new Error("STOP requested");
      }, mutation)
    ).rejects.toThrow("STOP requested");
    expect(mutation).not.toHaveBeenCalled();
  });
});
describe("requireDraftMutationGuard", () => {
  it("rejects draft saving without a mutation guard", () => {
    expect(() => requireDraftMutationGuard(undefined)).toThrow(
      "Draft save requires a mutation guard"
    );
  });
});
describe("requireImageMutationGuard", () => {
  it("rejects image uploading without a mutation guard", () => {
    expect(() => requireImageMutationGuard(undefined)).toThrow(
      "Image upload requires a mutation guard"
    );
  });
});
describe("validateDraftTitle", () => {
  it("accepts a matching title read back from the editor", () => {
    expect(() => validateDraftTitle(" Article title ", "Article title")).not.toThrow();
  });

  it("rejects a title that the editor did not retain", () => {
    expect(() => validateDraftTitle("Other title", "Article title")).toThrow(
      "draft title value mismatch"
    );
  });
});