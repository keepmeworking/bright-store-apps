import { access, constants, mkdir } from "fs/promises";
import { join } from "path";
import invariant from "tiny-invariant";
import { createLogger } from "../../../logger";

/**
 * Path will be relative to built file, in dev its inside .next/server
 */
const DEFAULT_TEMP_FILES_LOCATION = join(__dirname, "_temp");

const getTempPdfStorageDir = () => {
  return process.env.TEMP_PDF_STORAGE_DIR ?? DEFAULT_TEMP_FILES_LOCATION;
};

const logger = createLogger("resolveTempPdfFileLocation");

export const resolveTempPdfFileLocation = async (fileName: string) => {
  invariant(fileName.includes(".pdf"), `fileName should include pdf extension`);

  let dirToWrite = getTempPdfStorageDir();

  try {
    await access(dirToWrite, constants.W_OK);
  } catch (e) {
    try {
      await mkdir(dirToWrite, { recursive: true });
    } catch (mkdirError) {
      logger.warn(
        { dir: dirToWrite, error: mkdirError },
        "Can't create or access directory, falling back to /tmp",
      );
      dirToWrite = "/tmp";
    }
  }

  return join(dirToWrite, encodeURIComponent(fileName));
};
