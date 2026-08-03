"use client";

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import catalogJson from "./problemCatalog.json";
import {
  parseLeetBackup,
  parseRecoverySnapshots,
  parseStoredCustomProblems,
  parseStoredFavoriteSlugs,
  parseStoredLegacyProblems,
  parseStoredLogs,
  safeLocalDateToIso,
  type BackupV2,
  type CatalogProblem,
  type Difficulty,
  type LegacyProblem,
  type Mastery,
  type SolveLog,
} from "./domain";
import {
  readCloudState,
  supabase,
  writeCloudState,
  type CloudUser,
} from "./cloud";

type Tab = "today" | "library" | "insights" | "settings";
type Appearance = "system" | "light" | "dark";
type ProgressFilter = "全部" | "未刷" | "已刷";
type CloudSyncStatus = "checking" | "signed-out" | "email-sent" | "syncing" | "synced" | "error";

type EditorRequest = { problem: CatalogProblem; log?: SolveLog };

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CATALOG = catalogJson as CatalogProblem[];
const LIST_URL = "https://leetcode.cn/problem-list/7m3kaU3o/";
const LOGS_KEY = "leet-track-logs-v2";
const FAVORITES_KEY = "leet-track-favorites-v2";
const CUSTOM_KEY = "leet-track-custom-problems-v2";
const LEGACY_KEY = "leet-track-problems-v1";
const GOAL_KEY = "leet-track-weekly-goal";
const APPEARANCE_KEY = "leet-track-appearance";
const RECOVERY_KEY = "leet-track-recovery-v1";
const LOCAL_UPDATED_KEY = "leet-track-local-updated-at-v1";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86_400_000;
const NEVER_UPDATED = "1970-01-01T00:00:00.000Z";
const INVALID_JSON = Symbol("invalid-json");
const CUSTOM_TAG = "__custom__";
const COMMON_TAGS = [
  "数组",
  "哈希表",
  "双指针",
  "滑动窗口",
  "二分查找",
  "栈",
  "队列",
  "链表",
  "二叉树",
  "回溯",
  "贪心",
  "动态规划",
  "图",
  "堆",
] as const;

const difficultyMeta: Record<Difficulty, { className: string; mark: string }> = {
  简单: { className: "easy", mark: "叶" },
  中等: { className: "medium", mark: "闪" },
  困难: { className: "hard", mark: "焰" },
};

const statusMark: Record<Mastery, string> = {
  待复习: "↻",
  巩固中: "◐",
  已掌握: "✓",
};

function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function inputDate(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const weekday = result.getDay() || 7;
  result.setDate(result.getDate() - weekday + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function sortLogs(logs: SolveLog[]) {
  return [...logs].sort((a, b) => +new Date(b.solvedAt) - +new Date(a.solvedAt));
}

function readStoredJson(raw: string | null): unknown | typeof INVALID_JSON | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

function makeBackup(logs: SolveLog[], favoriteSlugs: string[], customProblems: CatalogProblem[], weeklyGoal: number): BackupV2 {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    listSlug: "7m3kaU3o",
    weeklyGoal,
    logs,
    favoriteSlugs,
    customProblems,
  };
}

function sameLogs(left: SolveLog[], right: SolveLog[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useEscape(onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscapeRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function isBundledDemo(items: LegacyProblem[]) {
  if (items.length !== 5) return false;
  const signature = items
    .map((item) => `${item.number}:${item.title}`)
    .sort()
    .join("|");
  return signature === [
    "1:两数之和",
    "3:无重复字符的最长子串",
    "15:三数之和",
    "42:接雨水",
    "206:反转链表",
  ].sort().join("|");
}

function migrateLegacy(items: LegacyProblem[]) {
  if (isBundledDemo(items)) {
    return { logs: [] as SolveLog[], favorites: [] as string[], custom: [] as CatalogProblem[] };
  }

  const custom: CatalogProblem[] = [];
  const favorites = new Set<string>();
  const logs = items.map((item, index) => {
    const match = CATALOG.find(
      (problem) => problem.number === item.number || problem.title === item.title,
    );
    const slug = match?.slug ?? `custom-${item.id}`;
    if (!match) {
      custom.push({
        order: CATALOG.length + index + 1,
        number: item.number,
        title: item.title,
        slug,
        difficulty: item.difficulty,
        custom: true,
      });
    }
    if (item.favorite) favorites.add(slug);
    return {
      id: item.id,
      problemSlug: slug,
      solvedAt: item.solvedAt,
      duration: item.duration,
      attempts: item.attempts,
      status: item.status,
      tags: item.tags,
      note: item.note,
    } satisfies SolveLog;
  });
  return { logs, favorites: [...favorites], custom };
}

function normalizeCloudBackup(backup: BackupV2) {
  const customProblems = backup.customProblems.filter((problem) =>
    !CATALOG.some((catalogProblem) => catalogProblem.slug === problem.slug),
  );
  const knownSlugs = new Set([...CATALOG, ...customProblems].map((problem) => problem.slug));
  return {
    ...backup,
    logs: backup.logs.filter((log) => knownSlugs.has(log.problemSlug)),
    favoriteSlugs: backup.favoriteSlugs.filter((slug) => knownSlugs.has(slug)),
    customProblems,
  } satisfies BackupV2;
}

export function LeetTrackApp() {
  const [logs, setLogs] = useState<SolveLog[]>([]);
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([]);
  const [customProblems, setCustomProblems] = useState<CatalogProblem[]>([]);
  const [weeklyGoal, setWeeklyGoal] = useState(7);
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [hydrated, setHydrated] = useState(false);
  const [storageWritable, setStorageWritable] = useState(true);
  const [storageIssue, setStorageIssue] = useState("");
  const [recoverySnapshots, setRecoverySnapshots] = useState<BackupV2[]>([]);
  const [tab, setTab] = useState<Tab>("today");
  const [editor, setEditor] = useState<EditorRequest>();
  const [detailProblem, setDetailProblem] = useState<CatalogProblem>();
  const [pendingUncheck, setPendingUncheck] = useState<CatalogProblem>();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [cloudUser, setCloudUser] = useState<CloudUser | null>();
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>("checking");
  const [cloudMessage, setCloudMessage] = useState("正在确认云同步状态…");
  const [cloudReady, setCloudReady] = useState(false);
  const [lastCloudSync, setLastCloudSync] = useState("");
  const [localUpdatedAt, setLocalUpdatedAt] = useState(NEVER_UPDATED);
  const [syncRequest, setSyncRequest] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const lastPushedAtRef = useRef("");
  const localStateRef = useRef({ logs, favoriteSlugs, customProblems, weeklyGoal, localUpdatedAt });

  const problems = useMemo(() => [...CATALOG, ...customProblems], [customProblems]);
  const orderedLogs = useMemo(() => sortLogs(logs), [logs]);
  const bestRecovery = useMemo(
    () => recoverySnapshots.find((snapshot) => snapshot.logs.length > logs.length),
    [logs.length, recoverySnapshots],
  );

  useEffect(() => {
    localStateRef.current = { logs, favoriteSlugs, customProblems, weeklyGoal, localUpdatedAt };
  }, [customProblems, favoriteSlugs, localUpdatedAt, logs, weeklyGoal]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const savedLogsRaw = localStorage.getItem(LOGS_KEY);
        const savedLogsJson = readStoredJson(savedLogsRaw);
        const savedLogs = savedLogsJson === undefined || savedLogsJson === INVALID_JSON
          ? null
          : parseStoredLogs(savedLogsJson);
        const savedFavoritesJson = readStoredJson(localStorage.getItem(FAVORITES_KEY));
        const savedFavorites = savedFavoritesJson === undefined
          ? []
          : savedFavoritesJson === INVALID_JSON ? null : parseStoredFavoriteSlugs(savedFavoritesJson);
        const savedCustomJson = readStoredJson(localStorage.getItem(CUSTOM_KEY));
        const savedCustom = savedCustomJson === undefined
          ? []
          : savedCustomJson === INVALID_JSON ? null : parseStoredCustomProblems(savedCustomJson);
        const legacyJson = readStoredJson(localStorage.getItem(LEGACY_KEY));
        const legacy = legacyJson === undefined || legacyJson === INVALID_JSON
          ? null
          : parseStoredLegacyProblems(legacyJson);
        const storedRecoveryJson = readStoredJson(localStorage.getItem(RECOVERY_KEY));
        const storedRecovery = storedRecoveryJson === undefined || storedRecoveryJson === INVALID_JSON
          ? []
          : parseRecoverySnapshots(storedRecoveryJson);

        if (savedLogsRaw !== null && !savedLogs) {
          setStorageWritable(false);
          setStorageIssue("检测到本机记录格式异常，题迹已停止写入，避免覆盖原始数据。");
        } else if (savedLogs) {
          setLogs(savedLogs);
          setFavoriteSlugs(savedFavorites ?? []);
          setCustomProblems(savedCustom ?? []);
          if (!savedFavorites || !savedCustom) {
            setStorageIssue("部分收藏或自定义题数据异常，刷题记录已安全保留。");
          }
        } else if (legacy) {
          const migrated = migrateLegacy(legacy);
          setLogs(migrated.logs);
          setFavoriteSlugs(migrated.favorites);
          setCustomProblems(migrated.custom);
        }

        if (legacy && !isBundledDemo(legacy)) {
          const migrated = migrateLegacy(legacy);
          storedRecovery.push(makeBackup(migrated.logs, migrated.favorites, migrated.custom, Number(localStorage.getItem(GOAL_KEY)) || 7));
        }
        const uniqueRecovery = storedRecovery
          .filter((snapshot, index, items) => items.findIndex((item) => sameLogs(item.logs, snapshot.logs)) === index)
          .sort((a, b) => b.logs.length - a.logs.length || +new Date(b.exportedAt) - +new Date(a.exportedAt));
        setRecoverySnapshots(uniqueRecovery);
        setWeeklyGoal(Number(localStorage.getItem(GOAL_KEY)) || 7);
        setAppearance((localStorage.getItem(APPEARANCE_KEY) as Appearance) || "system");
        const savedUpdatedAt = localStorage.getItem(LOCAL_UPDATED_KEY);
        const latestKnownSolve = savedLogs?.reduce(
          (latest, log) => Math.max(latest, Date.parse(log.solvedAt)),
          0,
        ) ?? 0;
        const migratedLatestSolve = legacy?.reduce(
          (latest, problem) => Math.max(latest, Date.parse(problem.solvedAt)),
          0,
        ) ?? 0;
        const inferredUpdatedAt = new Date(Math.max(latestKnownSolve, migratedLatestSolve, 0)).toISOString();
        setLocalUpdatedAt(savedUpdatedAt && Number.isFinite(Date.parse(savedUpdatedAt))
          ? savedUpdatedAt
          : inferredUpdatedAt);
      } catch {
        setStorageWritable(false);
        setStorageIssue("读取本机数据时发生异常，题迹已停止写入，避免覆盖原始记录。");
      }
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setCloudUser(null);
        setCloudStatus("error");
        setCloudMessage("登录状态读取失败，请稍后重试。");
        return;
      }
      setCloudUser(data.session?.user ?? null);
      setCloudStatus(data.session ? "checking" : "signed-out");
      setCloudMessage(data.session ? "正在检查云端记录…" : "登录后自动备份到云端，并可跨设备同步。");
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => {
        if (!active) return;
        setCloudUser(session?.user ?? null);
        setCloudReady(false);
        setCloudStatus(session ? "checking" : "signed-out");
        setCloudMessage(session ? "正在检查云端记录…" : "登录后自动备份到云端，并可跨设备同步。");
      });
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !cloudUser) return;
    let active = true;

    async function reconcileCloud() {
      setCloudReady(false);
      setCloudStatus("checking");
      setCloudMessage("正在比较本机与云端记录…");
      try {
        const userId = cloudUser!.id;
        const cloudRow = await readCloudState(userId);
        if (!active) return;
        const local = localStateRef.current;

        if (!cloudRow) {
          const initialUpdatedAt = local.localUpdatedAt === NEVER_UPDATED
            ? new Date().toISOString()
            : local.localUpdatedAt;
          if (initialUpdatedAt !== local.localUpdatedAt) setLocalUpdatedAt(initialUpdatedAt);
          const uploaded = await writeCloudState(
            userId,
            makeBackup(local.logs, local.favoriteSlugs, local.customProblems, local.weeklyGoal),
            initialUpdatedAt,
          );
          if (!active) return;
          lastPushedAtRef.current = uploaded.client_updated_at;
          setLastCloudSync(uploaded.updated_at);
          setCloudReady(true);
          setCloudStatus("synced");
          setCloudMessage(local.logs.length ? `已把本机 ${local.logs.length} 条记录备份到云端。` : "云同步已开启。");
          return;
        }

        const parsedCloud = parseLeetBackup(cloudRow.payload);
        if (!parsedCloud || parsedCloud.version !== 2) {
          throw new Error("Invalid cloud payload");
        }

        let syncedAt = cloudRow.updated_at;
        if (Date.parse(cloudRow.client_updated_at) > Date.parse(local.localUpdatedAt)) {
          const cloudBackup = normalizeCloudBackup(parsedCloud);
          setLogs(cloudBackup.logs);
          setFavoriteSlugs(cloudBackup.favoriteSlugs);
          setCustomProblems(cloudBackup.customProblems);
          setWeeklyGoal(cloudBackup.weeklyGoal);
          setLocalUpdatedAt(cloudRow.client_updated_at);
          lastPushedAtRef.current = cloudRow.client_updated_at;
          setCloudMessage(`已从云端恢复 ${cloudBackup.logs.length} 条记录。`);
        } else {
          const uploaded = await writeCloudState(
            userId,
            makeBackup(local.logs, local.favoriteSlugs, local.customProblems, local.weeklyGoal),
            local.localUpdatedAt,
          );
          if (!active) return;
          lastPushedAtRef.current = uploaded.client_updated_at;
          syncedAt = uploaded.updated_at;
          setCloudMessage("本机与云端记录已一致。");
        }

        setLastCloudSync(syncedAt);
        setCloudReady(true);
        setCloudStatus("synced");
      } catch {
        if (!active) return;
        setCloudReady(false);
        setCloudStatus("error");
        setCloudMessage("云同步暂时不可用，本机记录仍会继续安全保存。");
      }
    }

    void reconcileCloud();
    return () => { active = false; };
  }, [cloudUser, hydrated, syncRequest]);

  useEffect(() => {
    if (!hydrated || !cloudUser || !cloudReady || localUpdatedAt === NEVER_UPDATED) return;
    if (lastPushedAtRef.current === localUpdatedAt) return;

    setCloudStatus("syncing");
    setCloudMessage("本机已保存，正在同步到云端…");
    const timer = window.setTimeout(async () => {
      const local = localStateRef.current;
      try {
        const uploaded = await writeCloudState(
          cloudUser.id,
          makeBackup(local.logs, local.favoriteSlugs, local.customProblems, local.weeklyGoal),
          local.localUpdatedAt,
        );
        if (uploaded.client_updated_at === localStateRef.current.localUpdatedAt) {
          lastPushedAtRef.current = uploaded.client_updated_at;
          setLastCloudSync(uploaded.updated_at);
          setCloudStatus("synced");
          setCloudMessage("已同步到云端。");
        }
      } catch {
        setCloudStatus("error");
        setCloudMessage("云同步失败，本机记录已保存；联网后可点“立即同步”重试。");
      }
    }, 800);

    return () => window.clearTimeout(timer);
  }, [cloudReady, cloudUser, customProblems, favoriteSlugs, hydrated, localUpdatedAt, logs, weeklyGoal]);

  useEffect(() => {
    if (!hydrated || !storageWritable) return;
    try {
      const persistedLogsJson = readStoredJson(localStorage.getItem(LOGS_KEY));
      const persistedLogs = persistedLogsJson === undefined || persistedLogsJson === INVALID_JSON
        ? null
        : parseStoredLogs(persistedLogsJson);
      if (persistedLogs?.length && !sameLogs(persistedLogs, logs)) {
        const persistedFavoritesJson = readStoredJson(localStorage.getItem(FAVORITES_KEY));
        const persistedCustomJson = readStoredJson(localStorage.getItem(CUSTOM_KEY));
        const snapshot = makeBackup(
          persistedLogs,
          persistedFavoritesJson === undefined || persistedFavoritesJson === INVALID_JSON ? [] : parseStoredFavoriteSlugs(persistedFavoritesJson) ?? [],
          persistedCustomJson === undefined || persistedCustomJson === INVALID_JSON ? [] : parseStoredCustomProblems(persistedCustomJson) ?? [],
          Number(localStorage.getItem(GOAL_KEY)) || weeklyGoal,
        );
        const storedRecoveryJson = readStoredJson(localStorage.getItem(RECOVERY_KEY));
        const storedRecovery = storedRecoveryJson === undefined || storedRecoveryJson === INVALID_JSON
          ? []
          : parseRecoverySnapshots(storedRecoveryJson);
        const nextRecovery = [snapshot, ...storedRecovery]
          .filter((item, index, items) => items.findIndex((candidate) => sameLogs(candidate.logs, item.logs)) === index)
          .slice(0, 5);
        localStorage.setItem(RECOVERY_KEY, JSON.stringify(nextRecovery));
      }
      localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteSlugs));
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customProblems));
      localStorage.setItem(GOAL_KEY, String(weeklyGoal));
      localStorage.setItem(APPEARANCE_KEY, appearance);
      localStorage.setItem(LOCAL_UPDATED_KEY, localUpdatedAt);
    } catch {
      queueMicrotask(() => {
        setStorageWritable(false);
        setStorageIssue("保存失败，题迹已停止继续写入。请先导出备份，并检查浏览器存储空间。");
      });
    }
  }, [appearance, customProblems, favoriteSlugs, hydrated, localUpdatedAt, logs, storageWritable, weeklyGoal]);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
        .catch(() => undefined);
    }
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const parsed = readStoredJson(event.newValue);
      if (event.key === LOGS_KEY) {
        const nextLogs = parsed === undefined || parsed === INVALID_JSON ? null : parseStoredLogs(parsed);
        if (nextLogs) setLogs(nextLogs);
        else if (event.newValue !== null) {
          setStorageWritable(false);
          setStorageIssue("另一个页面写入了异常记录，题迹已停止同步以保护当前数据。");
        }
      }
      if (event.key === FAVORITES_KEY) {
        const nextFavorites = parsed === undefined || parsed === INVALID_JSON ? null : parseStoredFavoriteSlugs(parsed);
        if (nextFavorites) setFavoriteSlugs(nextFavorites);
      }
      if (event.key === CUSTOM_KEY) {
        const nextCustom = parsed === undefined || parsed === INVALID_JSON ? null : parseStoredCustomProblems(parsed);
        if (nextCustom) setCustomProblems(nextCustom);
      }
      if (event.key === RECOVERY_KEY) {
        setRecoverySnapshots(parsed === undefined || parsed === INVALID_JSON ? [] : parseRecoverySnapshots(parsed));
      }
      if (event.key === LOCAL_UPDATED_KEY && event.newValue && Number.isFinite(Date.parse(event.newValue))) {
        setLocalUpdatedAt(event.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function markLocalChange() {
    const changedAt = new Date().toISOString();
    setLocalUpdatedAt(changedAt);
    try {
      localStorage.setItem(LOCAL_UPDATED_KEY, changedAt);
    } catch {
      // The existing persistence guard will surface a storage failure.
    }
  }

  async function requestCloudLogin(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setCloudStatus("checking");
    setCloudMessage("正在发送登录邮件…");
    const redirectTo = `${window.location.origin}${BASE_PATH}/`;
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setCloudStatus("error");
      setCloudMessage("登录邮件发送失败，请检查邮箱后重试。");
      return;
    }
    setCloudStatus("email-sent");
    setCloudMessage("登录链接已发送，请到邮箱里点一下；回来后会自动同步。");
  }

  async function signOutCloud() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setCloudStatus("error");
      setCloudMessage("退出登录失败，请稍后重试。");
    }
  }

  function syncCloudNow() {
    if (!cloudUser) return;
    setCloudReady(false);
    setSyncRequest((current) => current + 1);
  }

  function logsFor(slug: string) {
    return orderedLogs.filter((log) => log.problemSlug === slug);
  }

  function saveLog(log: SolveLog, favorite: boolean) {
    markLocalChange();
    setLogs((current) => {
      const exists = current.some((item) => item.id === log.id);
      return exists
        ? current.map((item) => (item.id === log.id ? log : item))
        : [...current, log];
    });
    setFavoriteSlugs((current) =>
      favorite
        ? [...new Set([...current, log.problemSlug])]
        : current.filter((slug) => slug !== log.problemSlug),
    );
    setEditor(undefined);
  }

  function toggleChecked(problem: CatalogProblem) {
    const problemLogs = logs.filter((log) => log.problemSlug === problem.slug);
    if (problemLogs.length === 0) {
      setEditor({ problem });
      return;
    }
    setPendingUncheck(problem);
  }

  function confirmUncheck(problem: CatalogProblem) {
    markLocalChange();
    setLogs((current) => current.filter((log) => log.problemSlug !== problem.slug));
    if (detailProblem?.slug === problem.slug) setDetailProblem(undefined);
    setPendingUncheck(undefined);
  }

  function deleteLog(log: SolveLog) {
    if (window.confirm("删除这一次刷题记录？")) {
      markLocalChange();
      setLogs((current) => current.filter((item) => item.id !== log.id));
    }
  }

  function toggleFavorite(slug: string) {
    markLocalChange();
    setFavoriteSlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  function openProblem(problem: CatalogProblem) {
    if (logs.some((log) => log.problemSlug === problem.slug)) setDetailProblem(problem);
    else setEditor({ problem });
  }

  function exportBackup() {
    const backup = makeBackup(logs, favoriteSlugs, customProblems, weeklyGoal);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `题迹备份-${localDateKey(new Date())}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importBackup(file: File) {
    try {
      const backup = parseLeetBackup(JSON.parse(await file.text()));
      if (!backup) throw new Error("invalid backup");
      if (backup.version === 2) {
        const custom = backup.customProblems.filter((problem) =>
          !CATALOG.some((catalogProblem) => catalogProblem.slug === problem.slug),
        );
        const knownSlugs = new Set([...CATALOG, ...custom].map((problem) => problem.slug));
        const validLogs = backup.logs.filter((log) => knownSlugs.has(log.problemSlug));
        markLocalChange();
        setLogs(validLogs);
        setFavoriteSlugs(backup.favoriteSlugs.filter((slug) => knownSlugs.has(slug)));
        setCustomProblems(custom);
        setWeeklyGoal(Number(backup.weeklyGoal) || 7);
        window.alert(`已恢复 ${validLogs.length} 条刷题记录。`);
        return;
      }
      if (backup.version === 1) {
        const migrated = migrateLegacy(backup.problems);
        markLocalChange();
        setLogs(migrated.logs);
        setFavoriteSlugs(migrated.favorites);
        setCustomProblems(migrated.custom);
        setWeeklyGoal(Number(backup.weeklyGoal) || 7);
        window.alert(`已迁移 ${migrated.logs.length} 条旧版记录。`);
        return;
      }
      throw new Error("invalid backup");
    } catch {
      window.alert("这个备份文件无法读取，请选择从题迹导出的 JSON 文件。");
    }
  }

  function restoreRecovery(snapshot: BackupV2) {
    const custom = snapshot.customProblems.filter((problem) =>
      !CATALOG.some((catalogProblem) => catalogProblem.slug === problem.slug),
    );
    const knownSlugs = new Set([...CATALOG, ...custom].map((problem) => problem.slug));
    const recoveredLogs = snapshot.logs.filter((log) => knownSlugs.has(log.problemSlug));
    if (!recoveredLogs.length) {
      window.alert("这份恢复记录与当前题单不匹配，未修改现有数据。");
      return;
    }
    markLocalChange();
    setLogs(recoveredLogs);
    setFavoriteSlugs(snapshot.favoriteSlugs.filter((slug) => knownSlugs.has(slug)));
    setCustomProblems(custom);
    setWeeklyGoal(snapshot.weeklyGoal);
    setStorageWritable(true);
    setStorageIssue("");
    window.alert(`已找回 ${recoveredLogs.length} 条刷题记录。`);
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }
    window.alert("在 iPhone Safari 中：点击底部“分享”按钮，再选择“添加到主屏幕”。添加后请固定从同一入口使用；不同浏览器或主屏幕 App 的本地数据可能彼此独立。");
  }

  if (!hydrated) {
    return (
      <main className="loading-shell" aria-label="正在打开题迹">
        <div className="loading-mark">✓</div>
        <p>正在打开题迹…</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="page-frame">
        {logs.length === 0 && bestRecovery && (
          <DataRecoveryNotice
            count={bestRecovery.logs.length}
            onRestore={() => restoreRecovery(bestRecovery)}
          />
        )}
        {storageIssue && !(logs.length === 0 && bestRecovery) && (
          <div className="storage-warning" role="status"><strong>数据保护已开启</strong><span>{storageIssue}</span></div>
        )}
        {tab === "today" && (
          <Dashboard
            problems={problems}
            logs={orderedLogs}
            weeklyGoal={weeklyGoal}
            onBrowse={() => setTab("library")}
            onOpenProblem={(problem) => setDetailProblem(problem)}
          />
        )}
        {tab === "library" && (
          <Library
            problems={problems}
            logs={orderedLogs}
            favoriteSlugs={favoriteSlugs}
            onOpen={openProblem}
            onToggleChecked={toggleChecked}
            onToggleFavorite={toggleFavorite}
          />
        )}
        {tab === "insights" && <Insights problems={problems} logs={logs} />}
        {tab === "settings" && (
          <Settings
            logs={logs}
            solvedCount={new Set(logs.map((log) => log.problemSlug)).size}
            weeklyGoal={weeklyGoal}
            appearance={appearance}
            installPromptAvailable={Boolean(installPrompt)}
            cloudUser={cloudUser}
            cloudStatus={cloudStatus}
            cloudMessage={cloudMessage}
            lastCloudSync={lastCloudSync}
            onGoalChange={(goal) => {
              markLocalChange();
              setWeeklyGoal(goal);
            }}
            onAppearanceChange={setAppearance}
            onInstall={installApp}
            onCloudLogin={requestCloudLogin}
            onCloudSignOut={signOutCloud}
            onCloudSync={syncCloudNow}
            onExport={exportBackup}
            onImport={() => importRef.current?.click()}
            recoverableCount={bestRecovery?.logs.length ?? 0}
            onRecover={bestRecovery ? () => restoreRecovery(bestRecovery) : undefined}
            onClear={() => {
              if (window.confirm("清空全部刷题记录和收藏？题单仍会保留，这个操作无法撤销。")) {
                markLocalChange();
                setLogs([]);
                setFavoriteSlugs([]);
              }
            }}
          />
        )}
      </div>

      <nav className="tab-bar" aria-label="主要导航">
        <TabButton current={tab} value="today" label="进度" icon="⌁" onSelect={setTab} />
        <TabButton current={tab} value="library" label="题库" icon="☷" onSelect={setTab} />
        <TabButton current={tab} value="insights" label="统计" icon="▥" onSelect={setTab} />
        <TabButton current={tab} value="settings" label="设置" icon="⚙" onSelect={setTab} />
      </nav>

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importBackup(file);
          event.target.value = "";
        }}
      />

      {detailProblem && (
        <ProblemDetail
          problem={detailProblem}
          logs={logsFor(detailProblem.slug)}
          favorite={favoriteSlugs.includes(detailProblem.slug)}
          onClose={() => setDetailProblem(undefined)}
          onAdd={() => {
            setDetailProblem(undefined);
            setEditor({ problem: detailProblem });
          }}
          onEdit={(log) => {
            setDetailProblem(undefined);
            setEditor({ problem: detailProblem, log });
          }}
          onDelete={deleteLog}
          onToggleFavorite={() => toggleFavorite(detailProblem.slug)}
          onUncheck={() => toggleChecked(detailProblem)}
        />
      )}

      {editor && (
        <RecordEditor
          key={editor.log?.id ?? `${editor.problem.slug}-new`}
          request={editor}
          favorite={favoriteSlugs.includes(editor.problem.slug)}
          onCancel={() => setEditor(undefined)}
          onSave={saveLog}
        />
      )}

      {pendingUncheck && (
        <ConfirmUncheck
          problem={pendingUncheck}
          count={logs.filter((log) => log.problemSlug === pendingUncheck.slug).length}
          onCancel={() => setPendingUncheck(undefined)}
          onConfirm={() => confirmUncheck(pendingUncheck)}
        />
      )}
    </main>
  );
}

function TabButton({ current, value, label, icon, onSelect }: {
  current: Tab;
  value: Tab;
  label: string;
  icon: string;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <button
      className={current === value ? "tab-button active" : "tab-button"}
      onClick={() => onSelect(value)}
      aria-current={current === value ? "page" : undefined}
    >
      <span className="tab-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function PageHeader({ eyebrow, title, action }: {
  eyebrow?: string;
  title: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {action && <button className="header-action" onClick={action.onClick}>{action.label}</button>}
    </header>
  );
}

function Dashboard({ problems, logs, weeklyGoal, onBrowse, onOpenProblem }: {
  problems: CatalogProblem[];
  logs: SolveLog[];
  weeklyGoal: number;
  onBrowse: () => void;
  onOpenProblem: (problem: CatalogProblem) => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const solvedSlugs = new Set(logs.map((log) => log.problemSlug));
  const solvedCount = problems.filter((problem) => solvedSlugs.has(problem.slug)).length;
  const progress = Math.min(solvedCount / Math.max(problems.length, 1), 1);
  const weekStart = startOfWeek(new Date());
  const solvedThisWeek = logs.filter((log) => new Date(log.solvedAt) >= weekStart).length;
  const streak = getStreak(logs);
  const latestByProblem = new Map<string, SolveLog>();
  logs.forEach((log) => { if (!latestByProblem.has(log.problemSlug)) latestByProblem.set(log.problemSlug, log); });
  const mastered = [...latestByProblem.values()].filter((log) => log.status === "已掌握").length;
  const activity = getActivity(logs);
  const lookup = new Map(problems.map((problem) => [problem.slug, problem]));

  return (
    <section className="page">
      <PageHeader eyebrow={greeting} title="今天刷哪题？" action={{ label: "打开题库", onClick: onBrowse }} />

      <article className="goal-panel">
        <div>
          <p className="panel-kicker">真 Hot 100 · 题单进度</p>
          <strong>{solvedCount} <span>/ {problems.length}</span></strong>
          <p>{solvedCount === problems.length ? "全部完成" : `还有 ${problems.length - solvedCount} 题`}</p>
        </div>
        <div
          className="progress-ring"
          style={{ "--progress": `${progress * 360}deg` } as CSSProperties}
          role="img"
          aria-label={`题单完成 ${Math.round(progress * 100)}%`}
        >
          <span>{Math.round(progress * 100)}%</span>
        </div>
      </article>

      <div className="metric-line" aria-label="刷题概览">
        <Metric value={solvedThisWeek} label={`本周 / ${weeklyGoal}`} />
        <Metric value={streak} label="连续天数" />
        <Metric value={mastered} label="已掌握" />
      </div>

      <article className="surface activity-card">
        <SectionTitle title="最近 7 天" detail={`共 ${activity.reduce((sum, day) => sum + day.count, 0)} 次`} />
        <ActivityChart activity={activity} />
      </article>

      <article className="surface recent-card">
        <SectionTitle title="最近记录" detail={`${logs.length} 次`} />
        {logs.length === 0 ? (
          <EmptyState title="还没有记录" detail="去题库打下第一个勾。" action={{ label: "查看题库", onClick: onBrowse }} />
        ) : (
          logs.slice(0, 4).map((log) => {
            const problem = lookup.get(log.problemSlug);
            return problem ? <RecentLogRow key={log.id} problem={problem} log={log} onClick={() => onOpenProblem(problem)} /> : null;
          })
        )}
      </article>
    </section>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <div className="section-title"><h2>{title}</h2>{detail && <span>{detail}</span>}</div>;
}

function getActivity(logs: SolveLog[]) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      date,
      count: logs.filter((log) => localDateKey(log.solvedAt) === localDateKey(date)).length,
    };
  });
}

function getStreak(logs: SolveLog[]) {
  const days = new Set(logs.map((log) => localDateKey(log.solvedAt)));
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(localDateKey(cursor))) cursor = new Date(cursor.getTime() - DAY);
  let streak = 0;
  while (days.has(localDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY);
  }
  return streak;
}

function ActivityChart({ activity }: { activity: ReturnType<typeof getActivity> }) {
  const max = Math.max(...activity.map((item) => item.count), 1);
  return (
    <div className="activity-chart">
      {activity.map((item) => (
        <div className="activity-day" key={localDateKey(item.date)}>
          <span className="activity-count">{item.count || ""}</span>
          <div className="bar-track"><div className={localDateKey(item.date) === localDateKey(new Date()) ? "bar today" : "bar"} style={{ height: item.count ? `${Math.max(16, (item.count / max) * 100)}%` : "6px" }} /></div>
          <span>{new Intl.DateTimeFormat("zh-CN", { weekday: "narrow" }).format(item.date)}</span>
        </div>
      ))}
    </div>
  );
}

function RecentLogRow({ problem, log, onClick }: { problem: CatalogProblem; log: SolveLog; onClick: () => void }) {
  const meta = difficultyMeta[problem.difficulty];
  return (
    <button className="problem-row" onClick={onClick}>
      <span className={`problem-mark ${meta.className}`}>{statusMark[log.status]}</span>
      <span className="problem-copy">
        <strong><small>#{problem.number}</small>{problem.title}</strong>
        <span><b className={meta.className}>{problem.difficulty}</b> · {log.status} · {formatDate(log.solvedAt)}</span>
      </span>
      <span className="chevron" aria-hidden="true">›</span>
    </button>
  );
}

function Library({ problems, logs, favoriteSlugs, onOpen, onToggleChecked, onToggleFavorite }: {
  problems: CatalogProblem[];
  logs: SolveLog[];
  favoriteSlugs: string[];
  onOpen: (problem: CatalogProblem) => void;
  onToggleChecked: (problem: CatalogProblem) => void;
  onToggleFavorite: (slug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "全部">("全部");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("全部");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const groupedLogs = useMemo(() => {
    const map = new Map<string, SolveLog[]>();
    logs.forEach((log) => map.set(log.problemSlug, [...(map.get(log.problemSlug) ?? []), log]));
    return map;
  }, [logs]);
  const solvedCount = problems.filter((problem) => groupedLogs.has(problem.slug)).length;
  const filtered = problems.filter((problem) => {
    const problemLogs = groupedLogs.get(problem.slug) ?? [];
    const text = `${problem.number} ${problem.title} ${problemLogs.flatMap((log) => log.tags).join(" ")}`.toLowerCase();
    const solved = problemLogs.length > 0;
    return text.includes(query.trim().toLowerCase())
      && (difficulty === "全部" || problem.difficulty === difficulty)
      && (progressFilter === "全部" || (progressFilter === "已刷" ? solved : !solved))
      && (!favoritesOnly || favoriteSlugs.includes(problem.slug));
  });

  return (
    <section className="page library-page">
      <PageHeader eyebrow={`${solvedCount} / ${problems.length} 已刷`} title="真 Hot 100" />
      <div className="catalog-progress" aria-hidden="true"><i style={{ width: `${(solvedCount / problems.length) * 100}%` }} /></div>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input aria-label="搜索题目" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题号、题名或标签" />
      </label>
      <div className="filter-row" aria-label="完成状态筛选">
        {(["全部", "未刷", "已刷"] as ProgressFilter[]).map((item) => (
          <button key={item} aria-pressed={progressFilter === item} className={progressFilter === item ? "filter active" : "filter"} onClick={() => setProgressFilter(item)}>{item}</button>
        ))}
        <span className="filter-divider" aria-hidden="true" />
        {(["简单", "中等", "困难"] as Difficulty[]).map((item) => (
          <button key={item} aria-pressed={difficulty === item} className={difficulty === item ? "filter active" : "filter"} onClick={() => setDifficulty(difficulty === item ? "全部" : item)}>{item}</button>
        ))}
        <button aria-pressed={favoritesOnly} className={favoritesOnly ? "filter favorite active" : "filter favorite"} onClick={() => setFavoritesOnly(!favoritesOnly)}>◆ 收藏</button>
      </div>
      <div className="library-count">{filtered.length} 题 · 点圆圈勾选或取消</div>
      {filtered.length === 0 ? (
        <EmptyState title="没有匹配题目" detail="换个搜索词或筛选条件。" />
      ) : (
        <div className="library-list surface">
          {filtered.map((problem) => (
            <CatalogRow
              key={problem.slug}
              problem={problem}
              logs={sortLogs(groupedLogs.get(problem.slug) ?? [])}
              favorite={favoriteSlugs.includes(problem.slug)}
              onOpen={() => onOpen(problem)}
              onToggleChecked={() => onToggleChecked(problem)}
              onToggleFavorite={() => onToggleFavorite(problem.slug)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CatalogRow({ problem, logs, favorite, onOpen, onToggleChecked, onToggleFavorite }: {
  problem: CatalogProblem;
  logs: SolveLog[];
  favorite: boolean;
  onOpen: () => void;
  onToggleChecked: () => void;
  onToggleFavorite: () => void;
}) {
  const solved = logs.length > 0;
  const latest = logs[0];
  const meta = difficultyMeta[problem.difficulty];
  return (
    <div className={solved ? "catalog-row solved" : "catalog-row"}>
      <button className={solved ? "check-button checked" : "check-button"} onClick={onToggleChecked} aria-label={`${solved ? "取消" : "勾选"}${problem.title}`} aria-pressed={solved}>{solved ? "✓" : ""}</button>
      <button className="catalog-main" onClick={onOpen}>
        <span className="problem-copy">
          <strong><small>#{problem.number || "—"}</small>{problem.title}</strong>
          <span><b className={meta.className}>{problem.difficulty}</b> · {solved ? `${logs.length} 次 · ${formatDate(latest.solvedAt)}` : "未刷"}</span>
        </span>
      </button>
      <button className={favorite ? "favorite-button active" : "favorite-button"} onClick={onToggleFavorite} aria-label={favorite ? "取消收藏" : "收藏"}>◆</button>
      {!problem.custom && <a className="leetcode-link" href={`https://leetcode.cn/problems/${problem.slug}/`} target="_blank" rel="noreferrer" aria-label={`在力扣打开${problem.title}`}>↗</a>}
    </div>
  );
}

function Insights({ problems, logs }: { problems: CatalogProblem[]; logs: SolveLog[] }) {
  const solvedSlugs = new Set(logs.map((log) => log.problemSlug));
  const solvedProblems = problems.filter((problem) => solvedSlugs.has(problem.slug));
  const counts: Record<Difficulty, number> = { 简单: 0, 中等: 0, 困难: 0 };
  solvedProblems.forEach((problem) => { counts[problem.difficulty] += 1; });
  const tags = new Map<string, number>();
  let totalMinutes = 0;
  logs.forEach((log) => {
    totalMinutes += log.duration;
    log.tags.forEach((tag) => tags.set(tag, (tags.get(tag) ?? 0) + 1));
  });
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topCount = Math.max(topTags[0]?.[1] ?? 1, 1);
  const total = Math.max(solvedProblems.length, 1);
  const easyDeg = (counts.简单 / total) * 360;
  const mediumDeg = (counts.中等 / total) * 360;

  return (
    <section className="page">
      <PageHeader title="统计" />
      {logs.length === 0 ? (
        <EmptyState title="还没有统计" detail="完成一次刷题后即可查看。" />
      ) : (
        <>
          <div className="metric-line insights-metrics">
            <Metric value={solvedProblems.length} label="已刷题目" />
            <Metric value={logs.length} label="刷题次数" />
            <div className="duration-metric"><strong>{totalMinutes >= 60 ? `${(totalMinutes / 60).toFixed(1)}h` : `${totalMinutes}m`}</strong><span>累计投入</span></div>
          </div>
          <article className="surface insight-card">
            <SectionTitle title="难度分布" />
            <div className="donut-layout">
              <div className="donut" style={{ background: `conic-gradient(var(--easy) 0 ${easyDeg}deg, var(--medium) ${easyDeg}deg ${easyDeg + mediumDeg}deg, var(--hard) ${easyDeg + mediumDeg}deg 360deg)` }}>
                <div><strong>{solvedProblems.length}</strong><span>题</span></div>
              </div>
              <div className="legend">
                {(["简单", "中等", "困难"] as Difficulty[]).map((item) => <div key={item}><i className={difficultyMeta[item].className} /><span>{item}</span><strong>{counts[item]}</strong></div>)}
              </div>
            </div>
          </article>
          <article className="surface insight-card"><SectionTitle title="活跃趋势" detail="近 7 天" /><ActivityChart activity={getActivity(logs)} /></article>
          <article className="surface insight-card">
            <SectionTitle title="高频标签" detail="TOP 5" />
            {topTags.length === 0 ? <p className="muted-copy">添加标签后显示练习重点。</p> : (
              <div className="tag-stats">{topTags.map(([tag, count], index) => <div key={tag}><p><strong>{tag}</strong><span>{count} 次</span></p><div><i className={index === 0 ? "top" : ""} style={{ width: `${(count / topCount) * 100}%` }} /></div></div>)}</div>
            )}
          </article>
        </>
      )}
    </section>
  );
}

function Settings({ logs, solvedCount, weeklyGoal, appearance, installPromptAvailable, recoverableCount, cloudUser, cloudStatus, cloudMessage, lastCloudSync, onGoalChange, onAppearanceChange, onInstall, onCloudLogin, onCloudSignOut, onCloudSync, onExport, onImport, onRecover, onClear }: {
  logs: SolveLog[];
  solvedCount: number;
  weeklyGoal: number;
  appearance: Appearance;
  installPromptAvailable: boolean;
  recoverableCount: number;
  cloudUser: CloudUser | null | undefined;
  cloudStatus: CloudSyncStatus;
  cloudMessage: string;
  lastCloudSync: string;
  onGoalChange: (goal: number) => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onInstall: () => void;
  onCloudLogin: (email: string) => Promise<void>;
  onCloudSignOut: () => Promise<void>;
  onCloudSync: () => void;
  onExport: () => void;
  onImport: () => void;
  onRecover?: () => void;
  onClear: () => void;
}) {
  const [email, setEmail] = useState("");
  const cloudBusy = cloudStatus === "checking" || cloudStatus === "syncing";
  const cloudStatusLabel = cloudStatus === "synced"
    ? "已同步"
    : cloudStatus === "syncing" || cloudStatus === "checking"
      ? "同步中"
      : cloudStatus === "error" ? "待重试" : cloudStatus === "email-sent" ? "已发邮件" : "未登录";

  return (
    <section className="page settings-page">
      <PageHeader title="设置" />
      <article className="install-card">
        <span className="mini-app-icon">✓</span>
        <div><strong>安装到 iPhone</strong><p>从主屏幕快速打开</p></div>
        <button onClick={onInstall}>{installPromptAvailable ? "安装" : "查看方法"}</button>
      </article>
      <SettingsGroup title="题单">
        <div className="settings-row"><span>真 Hot 100</span><strong>117 题</strong></div>
        <a className="full-row-button settings-link" href={LIST_URL} target="_blank" rel="noreferrer">打开原题单 <span>↗</span></a>
      </SettingsGroup>
      <SettingsGroup title="目标">
        <div className="settings-row"><span>每周目标</span><div className="stepper"><button onClick={() => onGoalChange(Math.max(1, weeklyGoal - 1))} aria-label="减少每周目标">−</button><strong>{weeklyGoal} 次</strong><button onClick={() => onGoalChange(Math.min(30, weeklyGoal + 1))} aria-label="增加每周目标">＋</button></div></div>
      </SettingsGroup>
      <SettingsGroup title="云同步">
        {cloudUser ? (
          <>
            <div className="settings-row cloud-account-row">
              <span><i className={`cloud-dot ${cloudStatus}`} />云端账户</span>
              <strong>{cloudUser.email ?? "已登录"}</strong>
            </div>
            <div className="cloud-sync-copy" role="status">
              <strong>{cloudStatusLabel}</strong>
              <span>{cloudMessage}</span>
              {lastCloudSync && <small>上次同步：{formatDateTime(lastCloudSync)}</small>}
            </div>
            <button className="full-row-button" onClick={onCloudSync} disabled={cloudBusy}>立即同步 <span>↻</span></button>
            <button className="full-row-button subtle-danger" onClick={() => void onCloudSignOut()}>退出云端账户 <span>›</span></button>
          </>
        ) : (
          <form className="cloud-login" onSubmit={(event) => {
            event.preventDefault();
            void onCloudLogin(email);
          }}>
            <div className="cloud-sync-copy" role="status">
              <strong>{cloudStatusLabel}</strong>
              <span>{cloudMessage}</span>
            </div>
            <label>
              <span className="sr-only">登录邮箱</span>
              <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="输入邮箱，接收登录链接" />
              <button type="submit" disabled={cloudBusy || !email.trim()}>{cloudStatus === "email-sent" ? "重新发送" : "发送链接"}</button>
            </label>
          </form>
        )}
      </SettingsGroup>
      <SettingsGroup title="外观">
        <div className="appearance-options">{([["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as [Appearance, string][]).map(([value, label]) => <button key={value} className={appearance === value ? "active" : ""} aria-pressed={appearance === value} onClick={() => onAppearanceChange(value)}>{label}</button>)}</div>
      </SettingsGroup>
      <SettingsGroup title="数据">
        <div className="settings-row"><span>当前进度</span><strong>{solvedCount} 题 / {logs.length} 次</strong></div>
        <button className="full-row-button" onClick={onExport}>导出备份 <span>›</span></button>
        <button className="full-row-button" onClick={onImport}>导入备份 <span>›</span></button>
        {onRecover && <button className="full-row-button recovery-link" onClick={onRecover}>恢复本机旧记录 <span>{recoverableCount} 条 ›</span></button>}
        <button className="full-row-button danger-link" onClick={onClear} disabled={!logs.length}>清空刷题记录 <span>›</span></button>
      </SettingsGroup>
      <p className="privacy-note"><strong>{cloudUser ? "本机与云端双重保存" : "本机保存仍然有效"}</strong><br />{cloudUser ? "离线时照常记录，联网后自动同步。" : "登录云同步后可跨设备恢复；也建议定期导出备份。"}</p>
    </section>
  );
}

function DataRecoveryNotice({ count, onRestore }: { count: number; onRestore: () => void }) {
  return (
    <aside className="recovery-notice" role="status">
      <div><strong>发现可恢复的本机记录</strong><span>找到 {count} 条旧记录，恢复前不会覆盖原始数据。</span></div>
      <button onClick={onRestore}>立即找回</button>
    </aside>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="settings-group"><h2>{title}</h2><div className="surface">{children}</div></div>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: { label: string; onClick: () => void } }) {
  return <div className="empty-state"><span>＋</span><strong>{title}</strong><p>{detail}</p>{action && <button onClick={action.onClick}>{action.label}</button>}</div>;
}

function ProblemDetail({ problem, logs, favorite, onClose, onAdd, onEdit, onDelete, onToggleFavorite, onUncheck }: {
  problem: CatalogProblem;
  logs: SolveLog[];
  favorite: boolean;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (log: SolveLog) => void;
  onDelete: (log: SolveLog) => void;
  onToggleFavorite: () => void;
  onUncheck: () => void;
}) {
  useEscape(onClose);
  const meta = difficultyMeta[problem.difficulty];
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="editor-sheet detail-sheet" role="dialog" aria-modal="true" aria-label={`${problem.title}的刷题记录`}>
        <header><button autoFocus onClick={onClose}>关闭</button><h2>刷题记录</h2><button onClick={onAdd}>再刷一次</button></header>
        <div className="editor-content">
          <div className="detail-heading">
            <div><span className={meta.className}>#{problem.number} · {problem.difficulty}</span><h3>{problem.title}</h3></div>
            <button className={favorite ? "detail-favorite active" : "detail-favorite"} onClick={onToggleFavorite} aria-label={favorite ? "取消收藏" : "收藏"}>◆</button>
          </div>
          {!problem.custom && <a className="leetcode-cta" href={`https://leetcode.cn/problems/${problem.slug}/`} target="_blank" rel="noreferrer">去力扣刷这道题 <span>↗</span></a>}
          <div className="history-title"><strong>历史记录</strong><span>{logs.length} 次</span></div>
          <div className="history-list">
            {logs.map((log) => (
              <article className="surface history-card" key={log.id}>
                <div className="history-meta"><strong>{statusMark[log.status]} {log.status}</strong><span>{formatDateTime(log.solvedAt)}</span></div>
                <p>{log.duration} 分钟 · 尝试 {log.attempts} 次{log.tags.length ? ` · ${log.tags.join(" / ")}` : ""}</p>
                {log.note && <blockquote>{log.note}</blockquote>}
                <div><button onClick={() => onEdit(log)}>编辑</button><button className="danger-link" onClick={() => onDelete(log)}>删除这次</button></div>
              </article>
            ))}
          </div>
          <button className="uncheck-button" onClick={onUncheck}>取消勾选并删除全部记录</button>
        </div>
      </section>
    </div>
  );
}

function ConfirmUncheck({ problem, count, onCancel, onConfirm }: {
  problem: CatalogProblem;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscape(onCancel);
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="confirm-card surface" role="alertdialog" aria-modal="true" aria-label={`取消${problem.title}的已刷状态`}>
        <span className="confirm-icon">↶</span>
        <h2>取消这道题的勾选？</h2>
        <p>“{problem.title}”会变回未刷，并删除 {count} 条记录。</p>
        <div><button autoFocus onClick={onCancel}>保留记录</button><button className="confirm-danger" onClick={onConfirm}>取消勾选</button></div>
      </section>
    </div>
  );
}

function RecordEditor({ request, favorite, onCancel, onSave }: {
  request: EditorRequest;
  favorite: boolean;
  onCancel: () => void;
  onSave: (log: SolveLog, favorite: boolean) => void;
}) {
  useEscape(onCancel);
  const { problem, log } = request;
  const [status, setStatus] = useState<Mastery>(log?.status ?? "待复习");
  const [solvedAt, setSolvedAt] = useState(inputDate(log?.solvedAt ?? new Date().toISOString()));
  const [duration, setDuration] = useState(log?.duration ?? 30);
  const [attempts, setAttempts] = useState(log?.attempts ?? 1);
  const [tags, setTags] = useState<string[]>(log?.tags ?? []);
  const [note, setNote] = useState(log?.note ?? "");
  const [isFavorite, setIsFavorite] = useState(favorite);

  function submit(event: FormEvent) {
    event.preventDefault();
    const solvedAtIso = safeLocalDateToIso(solvedAt);
    if (!solvedAtIso) {
      window.alert("请选择有效的完成时间。");
      return;
    }
    onSave({
      id: log?.id ?? crypto.randomUUID(),
      problemSlug: problem.slug,
      status,
      solvedAt: solvedAtIso,
      duration,
      attempts,
      tags,
      note: note.trim(),
    }, isFavorite);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="editor-sheet" onSubmit={submit} role="dialog" aria-modal="true" aria-label={`记录${problem.title}`}>
        <header><button autoFocus type="button" onClick={onCancel}>取消</button><h2>{log ? "编辑记录" : "记录这一次"}</h2><button type="submit">保存</button></header>
        <div className="editor-content">
          <div className="selected-problem surface">
            <span className={difficultyMeta[problem.difficulty].className}>#{problem.number} · {problem.difficulty}</span>
            <strong>{problem.title}</strong>
          </div>
          <fieldset><legend>本次状态</legend><div className="surface form-surface"><Segmented values={["待复习", "巩固中", "已掌握"] as Mastery[]} value={status} onChange={setStatus} /></div></fieldset>
          <fieldset><legend>本次记录</legend><div className="surface form-surface">
            <label className="form-row"><span>完成时间</span><input required type="datetime-local" value={solvedAt} onChange={(event) => setSolvedAt(event.target.value)} /></label>
            <NumberStepper label="用时" value={duration} unit="分钟" min={1} max={300} step={5} onChange={setDuration} />
            <NumberStepper label="尝试次数" value={attempts} unit="次" min={1} max={20} step={1} onChange={setAttempts} />
          </div></fieldset>
          <fieldset><legend>标签（可多选）</legend><TagPicker value={tags} onChange={setTags} /></fieldset>
          <fieldset><legend>解题笔记</legend><textarea placeholder="记录思路、踩坑点或下次复习重点…" value={note} onChange={(event) => setNote(event.target.value)} rows={5} /></fieldset>
          <label className="favorite-toggle surface"><span>◆ 加入重点收藏</span><input type="checkbox" checked={isFavorite} onChange={(event) => setIsFavorite(event.target.checked)} /></label>
        </div>
      </form>
    </div>
  );
}

function Segmented<T extends string>({ values, value, onChange }: { values: T[]; value: T; onChange: (value: T) => void }) {
  return <div className="segmented">{values.map((item) => <button type="button" key={item} className={value === item ? "active" : ""} aria-pressed={value === item} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function TagPicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [customVisible, setCustomVisible] = useState(false);
  const [customTag, setCustomTag] = useState("");

  function addTag(tag: string) {
    const normalized = tag.trim();
    if (normalized && !value.includes(normalized)) onChange([...value, normalized]);
  }

  return (
    <div className="tag-picker surface">
      <select
        className="tag-select"
        aria-label="选择标签"
        value=""
        onChange={(event) => {
          if (event.target.value === CUSTOM_TAG) setCustomVisible(true);
          else if (event.target.value) addTag(event.target.value);
        }}
      >
        <option value="">选择常用标签…</option>
        {COMMON_TAGS.filter((tag) => !value.includes(tag)).map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        <option value={CUSTOM_TAG}>其他 / 自定义…</option>
      </select>
      {value.length > 0 && (
        <div className="tag-chips" aria-label="已选标签">
          {value.map((tag) => <button type="button" className="tag-chip" key={tag} onClick={() => onChange(value.filter((item) => item !== tag))}>{tag}<span aria-hidden="true">×</span></button>)}
        </div>
      )}
      {customVisible && (
        <div className="custom-tag-row">
          <input autoFocus value={customTag} onChange={(event) => setCustomTag(event.target.value)} placeholder="输入自定义标签" />
          <button type="button" onClick={() => { addTag(customTag); setCustomTag(""); setCustomVisible(false); }} disabled={!customTag.trim()}>添加</button>
        </div>
      )}
    </div>
  );
}

function NumberStepper({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <div className="form-row"><span>{label}</span><div className="inline-stepper"><button type="button" onClick={() => onChange(Math.max(min, value - step))}>−</button><strong>{value} {unit}</strong><button type="button" onClick={() => onChange(Math.min(max, value + step))}>＋</button></div></div>;
}
