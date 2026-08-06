import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArticleInput } from "../domain/article.js";
import { fileSafeTimestamp } from "../utils/time.js";

export function makeJobId(prefix = "job"): string {
  return `${prefix}-${fileSafeTimestamp()}-${randomUUID()}`;
}

export async function readArtifactFileInsideDirectory(
  artifactDir: string,
  fileName: string
): Promise<Buffer> {
  if (path.basename(fileName) !== fileName || fileName === "." || fileName === "..") {
    throw new Error("Artifact file name must not contain a path");
  }
  const physicalDir = await realpath(artifactDir);
  const physicalFile = await realpath(path.join(physicalDir, fileName));
  const relative = path.relative(physicalDir, physicalFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Artifact file must physically resolve inside its job directory");
  }
  if (!(await stat(physicalFile)).isFile()) {
    throw new Error("Artifact path is not a regular file");
  }
  return readFile(physicalFile);
}
export async function createArtifactDir(dataDir: string, jobId: string): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(jobId)) {
    throw new Error("Job ID is not safe for an artifact directory");
  }
  const dataRoot = path.resolve(dataDir);
  await mkdir(dataRoot, { recursive: true });
  const physicalDataRoot = await realpath(dataRoot);
  const jobsRoot = path.join(physicalDataRoot, "jobs");
  await mkdir(jobsRoot, { recursive: true });
  const physicalJobsRoot = await realpath(jobsRoot);
  const jobsRelative = path.relative(physicalDataRoot, physicalJobsRoot);
  if (!jobsRelative || jobsRelative.startsWith("..") || path.isAbsolute(jobsRelative)) {
    throw new Error("DATA_DIR/jobs must resolve inside DATA_DIR");
  }
  const dir = path.resolve(physicalJobsRoot, jobId);
  const relative = path.relative(physicalJobsRoot, dir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Artifact directory must be inside DATA_DIR/jobs");
  }
  await mkdir(dir, { recursive: true });
  const physicalDir = await realpath(dir);
  const physicalRelative = path.relative(physicalJobsRoot, physicalDir);
  if (
    !physicalRelative ||
    physicalRelative.startsWith("..") ||
    path.isAbsolute(physicalRelative)
  ) {
    throw new Error("Artifact directory must physically resolve inside DATA_DIR/jobs");
  }
  await mkdir(path.join(physicalDir, "screenshots"), { recursive: true });
  return physicalDir;
}
export async function writeTextArtifactAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function writeJsonArtifactAtomic(filePath: string, value: unknown): Promise<void> {
  let contents: string | undefined;
  try {
    contents = JSON.stringify(value, null, 2);
  } catch {
    throw new Error("Artifact value must be JSON-serializable");
  }
  if (contents === undefined) throw new Error("Artifact value must be JSON-serializable");
  await writeTextArtifactAtomic(filePath, contents);
}

export async function writeJsonArtifactExclusive(
  filePath: string,
  value: unknown
): Promise<void> {
  let contents: string | undefined;
  try {
    contents = JSON.stringify(value, null, 2);
  } catch {
    throw new Error("Artifact value must be JSON-serializable");
  }
  if (contents === undefined) throw new Error("Artifact value must be JSON-serializable");
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await link(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
export async function writeJobArtifacts(input: {
  artifactDir: string;
  job: unknown;
  article: ArticleInput;
  dryRun?: unknown;
  draft?: unknown;
  schedulePlan?: unknown;
}): Promise<void> {
  await writeJsonArtifactAtomic(path.join(input.artifactDir, "job.json"), input.job);
  await writeJsonArtifactAtomic(path.join(input.artifactDir, "article.json"), input.article);
  await writeTextArtifactAtomic(path.join(input.artifactDir, "article.html"), input.article.html);
  if (input.dryRun) {
    await writeJsonArtifactAtomic(path.join(input.artifactDir, "dry-run.json"), input.dryRun);
  }
  if (input.draft) {
    await writeJsonArtifactAtomic(path.join(input.artifactDir, "draft.json"), input.draft);
  }
  if (input.schedulePlan) {
    await writeJsonArtifactAtomic(
      path.join(input.artifactDir, "schedule-plan.json"),
      input.schedulePlan
    );
  }
}