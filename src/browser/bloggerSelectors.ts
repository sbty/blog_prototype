import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseJsonWithBom } from "../utils/json.js";

const selectorValue = z.string().trim().min(1).max(2000);

const selectorSchema = z
  .object({
    newPostButton: selectorValue.default(
      'a[href*="/blog/post/edit"], div[role="button"]:has-text("New post")'
    ),
    titleInput: selectorValue.default('input[aria-label*="Title"], input[placeholder*="Title"]'),
    htmlEditorToggle: selectorValue.optional(),
    bodyEditable: selectorValue.default('[contenteditable="true"]'),
    viewModeListbox: selectorValue.default('[jsname="o2UTnc"][role="listbox"]'),
    composeViewOption: selectorValue.default('[data-value="compose"][role="option"]'),
    insertImageButton: selectorValue.default(
      '[jsname="oS4M0c"][role="button"], [aria-label="\u753b\u50cf\u3092\u633f\u5165"][role="button"], [aria-label*="Insert image"][role="button"]'
    ),
    uploadFromComputerMenuItem: selectorValue.default(
      '[aria-label="\u30d1\u30bd\u30b3\u30f3\u304b\u3089\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9"][role="menuitem"], [aria-label*="Upload from computer"][role="menuitem"], [data-command="imageUploadPickerV2"], [data-command="+insertPhoto"][data-value="upload"]'
    ),
    imageFileInput: selectorValue.default(
      'input[type="file"][accept*="image"], input[type="file"]'
    ),
    imageBrowseButton: selectorValue.default(
      'button:has-text("Browse"), [role="button"]:has-text("Browse"), button:has-text("Choose"), [role="button"]:has-text("Choose"), button:has-text("\u53c2\u7167"), [role="button"]:has-text("\u53c2\u7167")'
    ),
    imageInsertButton: selectorValue.default(
      '[data-id="EBS5u"][role="button"], [data-mdc-dialog-action="ok"][role="button"], [role="button"]:has-text("Select"), [role="button"]:has-text("Insert")'
    ),
    insertedImage: selectorValue.default('[contenteditable="true"] img, .CodeMirror img'),
    labelsButton: selectorValue.default('[role="button"]:has-text("\u30e9\u30d9\u30eb")'),
    labelsInput: selectorValue.default(
      '[aria-label="\u30e9\u30d9\u30eb\u3092\u30ab\u30f3\u30de\u3067\u533a\u5207\u308b"]'
    ),
    searchDescriptionButton: selectorValue.default(
      '[role="button"]:has-text("\u691c\u7d22\u5411\u3051\u8aac\u660e")'
    ),
    searchDescriptionInput: selectorValue.default(
      '[aria-label="\u691c\u7d22\u5411\u3051\u8aac\u660e\u3092\u5165\u529b"]'
    ),
    permalinkButton: selectorValue.default(
      '[role="button"]:has-text("\u30d1\u30fc\u30de\u30ea\u30f3\u30af")'
    ),
    customPermalinkOption: selectorValue.default('[jsname="kriai"][role="radio"]'),
    permalinkInput: selectorValue.default('[jsname="hab8Qe"] input'),
    scheduleButton: selectorValue.default('[role="button"]:has-text("\u516c\u958b\u65e5")'),
    scheduleSetDateTime: selectorValue.default('[jsname="gAZRp"][role="radio"]'),
    scheduleDateInput: selectorValue.default('[aria-label="\u65e5\u4ed8"]'),
    scheduleTimeInput: selectorValue.default('[aria-label="\u6642\u523b"]'),
    saveButton: selectorValue.default(
      '[jsname="x8hlje"][role="button"], [aria-label*="Save"][role="button"], [data-tooltip*="Save"][role="button"]'
    ),
    moreOptionsButton: selectorValue.default(
      '[aria-label="\u305d\u306e\u4ed6\u306e\u30aa\u30d7\u30b7\u30e7\u30f3"][role="button"], [aria-label="More options"][role="button"]'
    ),
    saveMenuItem: selectorValue.default(
      '[role="menuitem"]:has-text("\u4fdd\u5b58"), [role="menuitem"]:has-text("Save")'
    ),
    saveCompleteIndicator: selectorValue.default(
      '.DPvwYc.ExSgfc.XMCYre, [aria-label*="Changes saved"], [title*="Changes saved"]'
    ),
    publishButton: selectorValue.default('div[role="button"]:has-text("Publish")'),
    publishConfirmButton: selectorValue.default(
      '[role="button"]:has-text("\u78ba\u5b9a"), [role="button"]:has-text("\u78ba\u8a8d"), [role="button"]:has-text("Confirm")'
    )
  })
  .strict();

export type BloggerSelectors = z.infer<typeof selectorSchema>;

export async function loadBloggerSelectors(
  selectorsPath: string,
  configRoot = path.resolve("config")
): Promise<BloggerSelectors> {
  const resolvedRoot = path.resolve(configRoot);
  const resolvedPath = path.resolve(selectorsPath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Blogger selectors path must be inside the config directory");
  }
  try {
    const [physicalRoot, physicalPath] = await Promise.all([
      realpath(resolvedRoot),
      realpath(resolvedPath)
    ]);
    const physicalRelative = path.relative(physicalRoot, physicalPath);
    if (
      !physicalRelative ||
      physicalRelative.startsWith("..") ||
      path.isAbsolute(physicalRelative)
    ) {
      throw new Error("Blogger selectors file must physically resolve inside config");
    }
    const raw = await readFile(physicalPath, "utf8");
    return selectorSchema.parse(parseJsonWithBom(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return selectorSchema.parse({});
    throw error;
  }
}
