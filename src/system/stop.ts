import { access } from "node:fs/promises";
import path from "node:path";

export class StopRequestedError extends Error {
  constructor(stopPath: string) {
    super(`STOP file exists: ${stopPath}`);
    this.name = "StopRequestedError";
  }
}

type AccessCheck = (target: string) => Promise<void>;

export async function assertNotStopped(
  dataDir: string,
  checkAccess: AccessCheck = access
): Promise<void> {
  const stopPath = path.join(dataDir, "STOP");
  try {
    await checkAccess(stopPath);
    throw new StopRequestedError(stopPath);
  } catch (error) {
    if (error instanceof StopRequestedError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return;
    }
    throw new Error(`Unable to verify STOP file: ${stopPath}`, { cause: error });
  }
}