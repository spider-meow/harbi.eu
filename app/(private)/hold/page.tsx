import { createClient } from "@/backend/supabase/server";
import { isHoldSetupError } from "@/backend/hold/constants";
import { listHoldFiles } from "@/backend/hold/files";
import { HoldWorkspace } from "./hold-workspace";

export default async function HoldPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let files: Awaited<ReturnType<typeof listHoldFiles>> = [];
  let setupError: string | null = null;

  try {
    files = await listHoldFiles();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hold is unavailable";
    setupError = isHoldSetupError(message)
      ? "The hold isn’t set up yet. Run supabase/hold.sql in the Supabase SQL editor, then raise the global file size limit to 25 GB."
      : message;
  }

  return (
    <HoldWorkspace
      userId={user?.id ?? ""}
      initialFiles={files}
      setupError={setupError}
    />
  );
}
