// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const LEETCODE_ENDPOINT = "https://leetcode.cn/graphql/noj-go/";
const SYNC_DAYS = new Set([1, 3, 7, 14, 30]);
const RECENT_QUERY = `
  query recentAcSubmissions($userSlug: String!) {
    recentACSubmissions(userSlug: $userSlug) {
      submissionId
      submitTime
      question {
        title
        translatedTitle
        titleSlug
        questionFrontendId
      }
    }
  }
`;

type RecentSubmission = {
  submissionId: number;
  submitTime: number;
  question: {
    title: string;
    translatedTitle?: string;
    titleSlug: string;
    questionFrontendId: string;
  };
};

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const handler = {
  fetch: withSupabase({ auth: "publishable" }, async (req) => {
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    let payload: { userSlug?: unknown; days?: unknown };
    try {
      payload = await req.json();
    } catch {
      return errorResponse("Invalid request body", 400);
    }

    const userSlug = typeof payload.userSlug === "string" ? payload.userSlug.trim() : "";
    const days = typeof payload.days === "number" ? payload.days : 0;
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(userSlug) || !SYNC_DAYS.has(days)) {
      return errorResponse("Invalid sync options", 400);
    }

    let upstream: Response;
    try {
      upstream = await fetch(LEETCODE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://leetcode.cn",
          "Referer": `https://leetcode.cn/u/${encodeURIComponent(userSlug)}/`,
          "User-Agent": "LeetTrack/1.0",
        },
        body: JSON.stringify({
          operationName: "recentAcSubmissions",
          variables: { userSlug },
          query: RECENT_QUERY,
        }),
      });
    } catch {
      return errorResponse("LeetCode is temporarily unavailable", 502);
    }

    if (!upstream.ok) return errorResponse("LeetCode rejected the request", 502);

    const result = await upstream.json() as {
      data?: { recentACSubmissions?: RecentSubmission[] };
      errors?: unknown[];
    };
    const recent = result.data?.recentACSubmissions;
    if (!Array.isArray(recent) || result.errors?.length) {
      return errorResponse("Unexpected LeetCode response", 502);
    }

    const cutoff = Math.floor(Date.now() / 1_000) - days * 86_400;
    const submissions = recent
      .filter((submission) => submission.submitTime >= cutoff)
      .map((submission) => ({
        submissionId: String(submission.submissionId),
        submitTime: submission.submitTime,
        titleSlug: submission.question.titleSlug,
        title: submission.question.translatedTitle || submission.question.title,
        questionFrontendId: submission.question.questionFrontendId,
      }));

    return Response.json({
      userSlug,
      days,
      availableCount: recent.length,
      limited: recent.length >= 15,
      submissions,
    });
  }),
};

export default handler;
