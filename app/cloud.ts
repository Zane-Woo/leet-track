import { createClient, type User } from "@supabase/supabase-js";
import type { BackupV2 } from "./domain";

// Publishable keys are intentionally safe to ship in a browser bundle. Access to
// user data is enforced by the RLS policies in supabase/migrations.
const SUPABASE_URL = "https://awmroqhcffgxbftfkdpd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_sgNIA3Mu6cpjVzrzDgyLtg_X7L3U3SJ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type CloudUser = User;

export type CloudStateRow = {
  user_id: string;
  payload: unknown;
  client_updated_at: string;
  updated_at: string;
};

export async function readCloudState(userId: string) {
  const { data, error } = await supabase
    .from("leet_track_state")
    .select("user_id,payload,client_updated_at,updated_at")
    .eq("user_id", userId)
    .maybeSingle<CloudStateRow>();

  if (error) throw error;
  return data;
}

export async function writeCloudState(
  userId: string,
  payload: BackupV2,
  clientUpdatedAt: string,
) {
  const { data, error } = await supabase
    .rpc("sync_leet_track_state", {
      p_payload: payload,
      p_client_updated_at: clientUpdatedAt,
    })
    .single<CloudStateRow>();

  if (error) throw error;
  if (data.user_id !== userId) throw new Error("Cloud user mismatch");
  return data;
}
