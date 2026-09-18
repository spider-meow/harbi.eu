"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/backend/supabase/server";
import type { Database } from "@/backend/supabase/types";
import {
  HOLD_BUCKET,
  HOLD_DOWNLOAD_TTL,
  HOLD_MAX_BYTES,
  HOLD_PREVIEW_MAX_BYTES,
  HOLD_PREVIEW_TTL,
} from "./constants";

export type HoldFileRecord = Database["public"]["Tables"]["hold_files"]["Row"];

export type HoldFile = HoldFileRecord & {
  previewUrl: string | null;
};

export async function listHoldFiles(): Promise<HoldFile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hold_files")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return Promise.all(
    rows.map(async (row) => {
      const canPreview =
        Boolean(row.mime?.startsWith("image/")) &&
        row.size_bytes <= HOLD_PREVIEW_MAX_BYTES;
      if (!canPreview) return { ...row, previewUrl: null };
      const { data: signed } = await supabase.storage
        .from(HOLD_BUCKET)
        .createSignedUrl(row.storage_path, HOLD_PREVIEW_TTL);
      return { ...row, previewUrl: signed?.signedUrl ?? null };
    }),
  );
}

export async function registerHoldFile(input: {
  name: string;
  mime: string;
  sizeBytes: number;
  storagePath: string;
}): Promise<HoldFile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (input.sizeBytes > HOLD_MAX_BYTES) {
    throw new Error("Too heavy — 25 GB is the ceiling.");
  }
  if (!input.storagePath.startsWith(`${user.id}/`)) {
    throw new Error("Invalid storage path");
  }

  const { data, error } = await supabase
    .from("hold_files")
    .insert({
      user_id: user.id,
      name,
      mime: input.mime || "application/octet-stream",
      size_bytes: input.sizeBytes,
      storage_path: input.storagePath,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/hold");
  return { ...data, previewUrl: null };
}

export async function deleteHoldFile(id: string): Promise<void> {
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("hold_files")
    .select("id, storage_path")
    .eq("id", id)
    .single();
  if (readError || !row) {
    throw new Error(readError?.message ?? "File not found");
  }

  const { error: storageError } = await supabase.storage
    .from(HOLD_BUCKET)
    .remove([row.storage_path]);
  if (storageError) throw new Error(storageError.message);

  const { error } = await supabase.from("hold_files").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/hold");
}

export async function signHoldDownload(id: string): Promise<string> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("hold_files")
    .select("name, storage_path")
    .eq("id", id)
    .single();
  if (error || !row) throw new Error(error?.message ?? "File not found");

  const { data, error: signError } = await supabase.storage
    .from(HOLD_BUCKET)
    .createSignedUrl(row.storage_path, HOLD_DOWNLOAD_TTL, {
      download: row.name,
    });
  if (signError || !data?.signedUrl) {
    throw new Error(signError?.message ?? "Could not prepare download");
  }
  return data.signedUrl;
}
