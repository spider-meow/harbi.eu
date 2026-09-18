import * as tus from "tus-js-client";
import { HOLD_BUCKET, HOLD_TUS_CHUNK } from "@/backend/hold/constants";
import { createClient } from "@/frontend/supabase/client";

export function storageTusEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (
    url.hostname.endsWith(".supabase.co") &&
    !url.hostname.includes(".storage.")
  ) {
    url.hostname = url.hostname.replace(
      ".supabase.co",
      ".storage.supabase.co",
    );
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

export function sanitizeObjectName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "file";
  const cleaned = base
    .replace(/[^\w.\-',! *&$@=;:+?() ]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();
  return cleaned || "file";
}

export type HoldUploadController = {
  start: () => void;
  pause: () => Promise<void>;
  resume: () => void;
  cancel: () => Promise<void>;
};

export function createHoldUpload(options: {
  file: File;
  objectPath: string;
  supabaseUrl: string;
  anonKey: string;
  onProgress: (bytes: number, total: number) => void;
  onSuccess: () => void;
  onError: (error: Error) => void;
}): HoldUploadController {
  const supabase = createClient();

  const upload = new tus.Upload(options.file, {
    endpoint: storageTusEndpoint(options.supabaseUrl),
    retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
    headers: {
      apikey: options.anonKey,
      "x-upsert": "false",
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName: HOLD_BUCKET,
      objectName: options.objectPath,
      contentType: options.file.type || "application/octet-stream",
      cacheControl: "3600",
      metadata: JSON.stringify({ originalName: options.file.name }),
    },
    chunkSize: HOLD_TUS_CHUNK,
    onBeforeRequest: async (req) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        req.setHeader("Authorization", `Bearer ${session.access_token}`);
      }
    },
    onError: (error) => {
      options.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    onProgress: options.onProgress,
    onSuccess: () => options.onSuccess(),
  });

  async function startWithResume() {
    try {
      const previous = await upload.findPreviousUploads();
      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
    } catch {
      // first attempt — no prior upload to resume
    }
    upload.start();
  }

  return {
    start: () => {
      void startWithResume();
    },
    pause: () => upload.abort(false),
    resume: () => {
      upload.start();
    },
    cancel: () => upload.abort(true),
  };
}
