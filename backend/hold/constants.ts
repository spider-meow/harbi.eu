export const HOLD_BUCKET = "hold";

/** 25 GiB — matches the bucket file_size_limit in supabase/hold.sql */
export const HOLD_MAX_BYTES = 25 * 1024 * 1024 * 1024;

/** Supabase TUS requires 6 MB chunks. Do not change. */
export const HOLD_TUS_CHUNK = 6 * 1024 * 1024;

export const HOLD_MAX_CONCURRENT = 2;

export const HOLD_DOWNLOAD_TTL = 60 * 60 * 12;
export const HOLD_PREVIEW_TTL = 60 * 60;
export const HOLD_PREVIEW_MAX_BYTES = 12 * 1024 * 1024;

export function isHoldSetupError(message: string): boolean {
  return /hold_files|schema cache|does not exist|bucket not found/i.test(
    message,
  );
}
