import { createClient, type User } from "@supabase/supabase-js";
import type { BackupV2 } from "./domain";
import {
  LEETCODE_USER_SLUG,
  parseLeetCodeSyncResponse,
  type LeetCodeSyncDays,
} from "./leetcode-sync";

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

export class LeetCodeSyncRequestError extends Error {}

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

export async function readRecentLeetCodeSubmissions(days: LeetCodeSyncDays) {
  let data: unknown;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await supabase.functions.invoke("leetcode-recent", {
      body: { userSlug: LEETCODE_USER_SLUG, days },
      timeout: 25_000,
    });
    if (!result.error) {
      data = result.data;
      break;
    }
    lastError = result.error;
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 800));
  }

  if (data === undefined) {
    const errorName = lastError instanceof Error ? lastError.name : "";
    const context = typeof lastError === "object" && lastError !== null && "context" in lastError
      ? (lastError as { context?: unknown }).context
      : undefined;
    const status = context instanceof Response ? context.status : 0;
    if (status === 401 || status === 403) {
      throw new LeetCodeSyncRequestError("同步服务认证失败，请刷新页面后再试。");
    }
    if (errorName === "FunctionsFetchError") {
      throw new LeetCodeSyncRequestError("手机暂时无法连接同步服务，已自动重试；请切换网络后再试。");
    }
    throw new LeetCodeSyncRequestError("力扣同步服务暂时不可用，已自动重试；请稍后再点一次。");
  }

  const parsed = parseLeetCodeSyncResponse(data);
  if (!parsed) throw new LeetCodeSyncRequestError("同步服务返回的数据格式异常，请稍后再试。");
  return parsed;
}
