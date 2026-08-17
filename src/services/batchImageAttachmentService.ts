import { validateImageFile, type ValidatedImageFile } from "../browser/imageFile.js";
import { batchManifestSchema, type BatchManifest } from "../domain/batch.js";
import { batchImageAssignmentsSchema } from "../domain/batchImages.js";

export interface AttachedBatchImage {
  blogKey: string;
  slug: string;
  imagePath: string;
  sizeBytes: number;
}

export interface BatchImageAttachmentResult {
  manifest: BatchManifest;
  images: AttachedBatchImage[];
}

type ImageValidator = (imagePath: string) => Promise<ValidatedImageFile>;

function itemKey(blogKey: string, slug: string): string {
  return `${blogKey}\0${slug}`;
}

export class BatchImageAttachmentService {
  constructor(private readonly validateImage: ImageValidator = validateImageFile) {}

  async execute(
    batchInput: unknown,
    assignmentsInput: unknown
  ): Promise<BatchImageAttachmentResult> {
    const batch = batchManifestSchema.parse(batchInput);
    const assignments = batchImageAssignmentsSchema.parse(assignmentsInput);
    const expectedKeys = new Set(
      batch.items.map((item) => itemKey(item.blogKey, item.article.slug))
    );
    const assignmentsByKey = new Map(
      assignments.items.map((item) => [itemKey(item.blogKey, item.slug), item])
    );

    const unexpected = assignments.items.filter(
      (item) => !expectedKeys.has(itemKey(item.blogKey, item.slug))
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Image assignments contain unknown batch items: ${unexpected
          .map((item) => `${item.blogKey}/${item.slug}`)
          .join(", ")}`
      );
    }

    const missing = batch.items.filter(
      (item) => !assignmentsByKey.has(itemKey(item.blogKey, item.article.slug))
    );
    if (missing.length > 0) {
      throw new Error(
        `Image assignments are missing batch items: ${missing
          .map((item) => `${item.blogKey}/${item.article.slug}`)
          .join(", ")}`
      );
    }

    const alreadyAssigned = batch.items.filter((item) => item.article.imagePath);
    if (alreadyAssigned.length > 0) {
      throw new Error(
        `Batch items already contain imagePath: ${alreadyAssigned
          .map((item) => `${item.blogKey}/${item.article.slug}`)
          .join(", ")}`
      );
    }

    const validated = await Promise.all(
      batch.items.map(async (item) => {
        const assignment = assignmentsByKey.get(itemKey(item.blogKey, item.article.slug))!;
        const image = await this.validateImage(assignment.imagePath);
        return { item, image };
      })
    );
    const imageOwners = new Map<string, string>();
    for (const { item, image } of validated) {
      const owner = `${item.blogKey}/${item.article.slug}`;
      const previousOwner = imageOwners.get(image.absolutePath);
      if (previousOwner) {
        throw new Error(
          `Image file is assigned to multiple batch items: ${previousOwner}, ${owner}`
        );
      }
      imageOwners.set(image.absolutePath, owner);
    }

    const manifest = batchManifestSchema.parse({
      ...batch,
      items: validated.map(({ item, image }) => ({
        ...item,
        article: { ...item.article, imagePath: image.absolutePath }
      }))
    });
    return {
      manifest,
      images: validated.map(({ item, image }) => ({
        blogKey: item.blogKey,
        slug: item.article.slug,
        imagePath: image.absolutePath,
        sizeBytes: image.sizeBytes
      }))
    };
  }
}
