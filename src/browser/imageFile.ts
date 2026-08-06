import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
export const MAX_BLOGGER_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ValidatedImageFile {
  absolutePath: string;
  extension: string;
  sizeBytes: number;
}

export async function validateImageFile(imagePath: string): Promise<ValidatedImageFile> {
  const absolutePath = path.resolve(imagePath);
  const extension = path.extname(absolutePath).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported image extension: ${extension || "(none)"}`);
  }

  let link;
  try {
    link = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Image file does not exist: ${absolutePath}`);
    }
    throw error;
  }
  if (link.isSymbolicLink()) {
    throw new Error(`Image path must not be a symbolic link: ${absolutePath}`);
  }
  const physicalPath = await realpath(absolutePath);
  const file = await stat(physicalPath);
  if (!file.isFile()) {
    throw new Error(`Image path is not a file: ${physicalPath}`);
  }
  if (file.size === 0) {
    throw new Error(`Image file is empty: ${physicalPath}`);
  }
  if (file.size > MAX_BLOGGER_IMAGE_BYTES) {
    throw new Error(`Image file exceeds ${MAX_BLOGGER_IMAGE_BYTES} bytes: ${physicalPath}`);
  }

  const handle = await open(physicalPath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const detected = detectImageExtension(header.subarray(0, bytesRead));
    const normalizedExtension = extension === ".jpeg" ? ".jpg" : extension;
    if (!detected || normalizedExtension !== detected) {
      throw new Error(`Image contents do not match extension ${extension}: ${physicalPath}`);
    }
  } finally {
    await handle.close();
  }
  return { absolutePath: physicalPath, extension, sizeBytes: file.size };
}

function detectImageExtension(header: Buffer): ".jpg" | ".png" | ".gif" | ".webp" | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return ".jpg";
  }
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return ".png";
  }
  if (
    header.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii"))
  ) {
    return ".gif";
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}