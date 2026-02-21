import { normalizeSaleorApiUrl } from "./saleor-api-url";

type SaleorUploadResponse = {
  data?: {
    fileUpload?: {
      uploadedFile?: { url: string; contentType?: string | null } | null;
      errors?: Array<{ message?: string | null; code?: string | null }>;
    } | null;
  };
  errors?: Array<{ message?: string | null }>;
};

type UploadFileToSaleorInput = {
  saleorApiUrl: string;
  token: string;
  file: File;
};

export type UploadedSaleorFile = {
  url: string;
  contentType: string;
};

export type ExtractedVideoAsset = {
  durationSeconds: number;
  width: number;
  height: number;
  thumbnail: File | null;
};

const FILE_UPLOAD_MUTATION = `
  mutation FileUpload($file: Upload!) {
    fileUpload(file: $file) {
      uploadedFile {
        url
        contentType
      }
      errors {
        message
        code
      }
    }
  }
`;

const getFirstErrorMessage = (payload: SaleorUploadResponse) => {
  const topLevel = payload.errors?.find((error) => Boolean(error.message))?.message;
  if (topLevel) return topLevel;
  const uploadError = payload.data?.fileUpload?.errors?.find((error) => Boolean(error.message))?.message;
  if (uploadError) return uploadError;
  return "";
};

export const uploadFileToSaleor = async (input: UploadFileToSaleorInput): Promise<UploadedSaleorFile> => {
  const operations = JSON.stringify({
    query: FILE_UPLOAD_MUTATION,
    variables: { file: null },
  });
  const map = JSON.stringify({ "0": ["variables.file"] });
  const formData = new FormData();
  formData.append("operations", operations);
  formData.append("map", map);
  formData.append("0", input.file, input.file.name);

  const response = await fetch(normalizeSaleorApiUrl(input.saleorApiUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Authorization-Bearer": input.token,
      Accept: "application/json",
    },
    body: formData,
  });

  const payload = (await response.json()) as SaleorUploadResponse;
  if (!response.ok) {
    throw new Error(getFirstErrorMessage(payload) || `Upload failed with HTTP ${response.status}.`);
  }

  const uploaded = payload.data?.fileUpload?.uploadedFile;
  if (!uploaded?.url) {
    throw new Error(getFirstErrorMessage(payload) || "Saleor did not return uploaded file URL.");
  }

  return {
    url: uploaded.url,
    contentType: uploaded.contentType || input.file.type || "application/octet-stream",
  };
};

const createVideoElement = (src: string) =>
  new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("Unable to read video metadata."));
    video.src = src;
  });

const seekVideo = (video: HTMLVideoElement, timeSeconds: number) =>
  new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("Unable to seek video for thumbnail extraction."));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.max(0, timeSeconds);
  });

export const extractVideoAsset = async (file: File): Promise<ExtractedVideoAsset> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = await createVideoElement(objectUrl);
    const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;

    if (duration > 0.2) {
      await seekVideo(video, Math.min(0.5, duration / 3));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width || 720;
    canvas.height = height || 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { durationSeconds: duration, width, height, thumbnail: null };
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const thumbnailBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const thumbnail = thumbnailBlob
      ? new File([thumbnailBlob], `${baseName}-thumbnail.jpg`, { type: "image/jpeg" })
      : null;

    return {
      durationSeconds: duration,
      width,
      height,
      thumbnail,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
