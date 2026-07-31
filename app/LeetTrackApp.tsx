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

type Difficulty = "简单" | "中等" | "困难";
type Mastery = "待复习" | "巩固中" | "已掌握";
type Tab = "today" | "library" | "insights" | "settings";
type Appearance = "system" | "light" | "dark";
type ProgressFilter = "全部" | "未刷" | "已刷";

type CatalogProblem = {
  order: number;
  number: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  custom?: boolean;
};

type SolveLog = {
  id: string;
  problemSlug: string;
  solvedAt: string;
  duration: number;
  attempts: number;
  status: Mastery;
  tags: string[];
  note: string;
};

type LegacyProblem = {
  id: string;
  number: string;
  title: string;
  difficulty: Difficulty;
  status: Mastery;
  tags: string[];
  solvedAt: string;
  duration: number;
  attempts: number;
  note: string;
  favorite: boolean;
};

type BackupV2 = {
  version: 2;
  exportedAt: string;
  listSlug: "7m3kaU3o";
  weeklyGoal: number;
  logs: SolveLog[];
  favoriteSlugs: string[];
  customProblems: CatalogProblem[];
};

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
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86_400_000;

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

export function LeetTrackApp() {
  const [logs, setLogs] = useState<SolveLog[]>([]);
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([]);
  const [customProblems, setCustomProblems] = useState<CatalogProblem[]>([]);
  const [weeklyGoal, setWeeklyGoal] = useState(7);
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [editor, setEditor] = useState<EditorRequest>();
  const [detailProblem, setDetailProblem] = useState<CatalogProblem>();
  const [pendingUncheck, setPendingUncheck] = useState<CatalogProblem>();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const problems = useMemo(() => [...CATALOG, ...customProblems], [customProblems]);
  const orderedLogs = useMemo(() => sortLogs(logs), [logs]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const savedLogs = localStorage.getItem(LOGS_KEY);
        if (savedLogs) {
          setLogs(JSON.parse(savedLogs) as SolveLog[]);
          setFavoriteSlugs(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"));
          setCustomProblems(JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]"));
        } else {
          const legacyRaw = localStorage.getItem(LEGACY_KEY);
          if (legacyRaw) {
            const migrated = migrateLegacy(JSON.parse(legacyRaw) as LegacyProblem[]);
            setLogs(migrated.logs);
            setFavoriteSlugs(migrated.favorites);
            setCustomProblems(migrated.custom);
          }
        }
        setWeeklyGoal(Number(localStorage.getItem(GOAL_KEY)) || 7);
        setAppearance((localStorage.getItem(APPEARANCE_KEY) as Appearance) || "system");
      } catch {
        setLogs([]);
        setFavoriteSlugs([]);
        setCustomProblems([]);
      }
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteSlugs));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customProblems));
    localStorage.setItem(GOAL_KEY, String(weeklyGoal));
    localStorage.setItem(APPEARANCE_KEY, appearance);
  }, [appearance, customProblems, favoriteSlugs, hydrated, logs, weeklyGoal]);

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

  function logsFor(slug: string) {
    return orderedLogs.filter((log) => log.problemSlug === slug);
  }

  function saveLog(log: SolveLog, favorite: boolean) {
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
    setLogs((current) => current.filter((log) => log.problemSlug !== problem.slug));
    if (detailProblem?.slug === problem.slug) setDetailProblem(undefined);
    setPendingUncheck(undefined);
  }

  function deleteLog(log: SolveLog) {
    if (window.confirm("删除这一次刷题记录？")) {
      setLogs((current) => current.filter((item) => item.id !== log.id));
    }
  }

  function toggleFavorite(slug: string) {
    setFavoriteSlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  function openProblem(problem: CatalogProblem) {
    if (logs.some((log) => log.problemSlug === problem.slug)) setDetailProblem(problem);
    else setEditor({ problem });
  }

  function exportBackup() {
    const backup: BackupV2 = {
      version: 2,
      exportedAt: new Date().toISOString(),
      listSlug: "7m3kaU3o",
      weeklyGoal,
      logs,
      favoriteSlugs,
      customProblems,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `题迹备份-${localDateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file: File) {
    try {
      const backup = JSON.parse(await file.text()) as BackupV2 | { version: 1; weeklyGoal: number; problems: LegacyProblem[] };
      if (backup.version === 2 && Array.isArray(backup.logs)) {
        setLogs(backup.logs);
        setFavoriteSlugs(Array.isArray(backup.favoriteSlugs) ? backup.favoriteSlugs : []);
        setCustomProblems(Array.isArray(backup.customProblems) ? backup.customProblems : []);
        setWeeklyGoal(Number(backup.weeklyGoal) || 7);
        window.alert(`已恢复 ${backup.logs.length} 条刷题记录。`);
        return;
      }
      if (backup.version === 1 && Array.isArray(backup.problems)) {
        const migrated = migrateLegacy(backup.problems);
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

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }
    window.alert("在 iPhone Safari 中：点击底部“分享”按钮，再选择“添加到主屏幕”。");
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
            onGoalChange={setWeeklyGoal}
            onAppearanceChange={setAppearance}
            onInstall={installApp}
            onExport={exportBackup}
            onImport={() => importRef.current?.click()}
            onClear={() => {
              if (window.confirm("清空全部刷题记录和收藏？题单仍会保留，这个操作无法撤销。")) {
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
      <PageHeader eyebrow={greeting} title="今天，继续向前一题。" action={{ label: "打开题库", onClick: onBrowse }} />

      <article className="goal-panel">
        <div>
          <p className="panel-kicker">◎ 真hot100 题单进度</p>
          <strong>{solvedCount} <span>/ {problems.length}</span></strong>
          <p>{solvedCount === problems.length ? "题单全部刷完，漂亮！" : `还有 ${problems.length - solvedCount} 题尚未打勾`}</p>
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
        <SectionTitle title="最近记录" detail={`${logs.length} 次刷题`} />
        {logs.length === 0 ? (
          <EmptyState title="从题单里打第一个勾" detail="进入题库，点题目前面的圆圈并记录本次练习。" action={{ label: "查看 117 道题", onClick: onBrowse }} />
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
      <PageHeader eyebrow={`已刷 ${solvedCount} / ${problems.length}`} title="真hot100 题库" />
      <div className="catalog-progress" aria-hidden="true"><i style={{ width: `${(solvedCount / problems.length) * 100}%` }} /></div>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题号、名称或笔记标签" />
      </label>
      <div className="filter-row" aria-label="完成状态筛选">
        {(["全部", "未刷", "已刷"] as ProgressFilter[]).map((item) => (
          <button key={item} className={progressFilter === item ? "filter active" : "filter"} onClick={() => setProgressFilter(item)}>{item}</button>
        ))}
        <span className="filter-divider" aria-hidden="true" />
        {(["简单", "中等", "困难"] as Difficulty[]).map((item) => (
          <button key={item} className={difficulty === item ? "filter active" : "filter"} onClick={() => setDifficulty(difficulty === item ? "全部" : item)}>{item}</button>
        ))}
        <button className={favoritesOnly ? "filter favorite active" : "filter favorite"} onClick={() => setFavoritesOnly(!favoritesOnly)}>◆ 收藏</button>
      </div>
      <div className="library-count">显示 {filtered.length} 题 · 点击圆圈勾选或取消</div>
      {filtered.length === 0 ? (
        <EmptyState title="没有找到匹配题目" detail="换个题号、名称或筛选条件试试。" />
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
          <span><b className={meta.className}>{problem.difficulty}</b> · {solved ? `刷过 ${logs.length} 次 · 最近 ${formatDate(latest.solvedAt)}` : "尚未刷过"}</span>
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
        <EmptyState title="数据正在等待第一个勾" detail="记录一次刷题后，这里会展示练习趋势。" />
      ) : (
        <>
          <div className="metric-line insights-metrics">
            <Metric value={solvedProblems.length} label="已刷题目" />
            <Metric value={logs.length} label="刷题次数" />
            <div className="duration-metric"><strong>{totalMinutes >= 60 ? `${(totalMinutes / 60).toFixed(1)}h` : `${totalMinutes}m`}</strong><span>累计投入</span></div>
          </div>
          <article className="surface insight-card">
            <SectionTitle title="已刷难度分布" />
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
            {topTags.length === 0 ? <p className="muted-copy">记录标签后，这里会显示你的练习重点。</p> : (
              <div className="tag-stats">{topTags.map(([tag, count], index) => <div key={tag}><p><strong>{tag}</strong><span>{count} 次</span></p><div><i className={index === 0 ? "top" : ""} style={{ width: `${(count / topCount) * 100}%` }} /></div></div>)}</div>
            )}
          </article>
        </>
      )}
    </section>
  );
}

function Settings({ logs, solvedCount, weeklyGoal, appearance, installPromptAvailable, onGoalChange, onAppearanceChange, onInstall, onExport, onImport, onClear }: {
  logs: SolveLog[];
  solvedCount: number;
  weeklyGoal: number;
  appearance: Appearance;
  installPromptAvailable: boolean;
  onGoalChange: (goal: number) => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onInstall: () => void;
  onExport: () => void;
  onImport: () => void;
  onClear: () => void;
}) {
  return (
    <section className="page settings-page">
      <PageHeader title="设置" />
      <article className="install-card">
        <span className="mini-app-icon">✓</span>
        <div><strong>安装到 iPhone 主屏幕</strong><p>全屏打开，使用体验更像原生 App。</p></div>
        <button onClick={onInstall}>{installPromptAvailable ? "安装" : "查看方法"}</button>
      </article>
      <SettingsGroup title="题单">
        <div className="settings-row"><span>真hot100</span><strong>117 题</strong></div>
        <a className="full-row-button settings-link" href={LIST_URL} target="_blank" rel="noreferrer">查看力扣原题单 <span>↗</span></a>
      </SettingsGroup>
      <SettingsGroup title="目标">
        <div className="settings-row"><span>每周刷题次数</span><div className="stepper"><button onClick={() => onGoalChange(Math.max(1, weeklyGoal - 1))} aria-label="减少每周目标">−</button><strong>{weeklyGoal} 次</strong><button onClick={() => onGoalChange(Math.min(30, weeklyGoal + 1))} aria-label="增加每周目标">＋</button></div></div>
      </SettingsGroup>
      <SettingsGroup title="外观">
        <div className="appearance-options">{([["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as [Appearance, string][]).map(([value, label]) => <button key={value} className={appearance === value ? "active" : ""} onClick={() => onAppearanceChange(value)}>{label}</button>)}</div>
      </SettingsGroup>
      <SettingsGroup title="数据">
        <div className="settings-row"><span>当前进度</span><strong>{solvedCount} 题 / {logs.length} 次</strong></div>
        <button className="full-row-button" onClick={onExport}>导出备份 <span>›</span></button>
        <button className="full-row-button" onClick={onImport}>导入备份 <span>›</span></button>
        <button className="full-row-button danger-link" onClick={onClear} disabled={!logs.length}>清空刷题记录 <span>›</span></button>
      </SettingsGroup>
      <p className="privacy-note"><strong>数据只属于你</strong><br />题单内置在应用中，刷题记录只保存在当前设备。清除 Safari 网站数据前，请先导出备份。</p>
    </section>
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
  const meta = difficultyMeta[problem.difficulty];
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="editor-sheet detail-sheet" role="dialog" aria-modal="true" aria-label={`${problem.title}的刷题记录`}>
        <header><button onClick={onClose}>关闭</button><h2>刷题记录</h2><button onClick={onAdd}>再刷一次</button></header>
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
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="confirm-card surface" role="alertdialog" aria-modal="true" aria-label={`取消${problem.title}的已刷状态`}>
        <span className="confirm-icon">↶</span>
        <h2>取消这道题的勾选？</h2>
        <p>“{problem.title}”将恢复为未刷状态，同时删除 {count} 条刷题记录。</p>
        <div><button onClick={onCancel}>保留记录</button><button className="confirm-danger" onClick={onConfirm}>取消勾选</button></div>
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
  const { problem, log } = request;
  const [status, setStatus] = useState<Mastery>(log?.status ?? "待复习");
  const [solvedAt, setSolvedAt] = useState(inputDate(log?.solvedAt ?? new Date().toISOString()));
  const [duration, setDuration] = useState(log?.duration ?? 30);
  const [attempts, setAttempts] = useState(log?.attempts ?? 1);
  const [tags, setTags] = useState(log?.tags.join("，") ?? "");
  const [note, setNote] = useState(log?.note ?? "");
  const [isFavorite, setIsFavorite] = useState(favorite);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: log?.id ?? crypto.randomUUID(),
      problemSlug: problem.slug,
      status,
      solvedAt: new Date(solvedAt).toISOString(),
      duration,
      attempts,
      tags: [...new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))],
      note: note.trim(),
    }, isFavorite);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="editor-sheet" onSubmit={submit} role="dialog" aria-modal="true" aria-label={`记录${problem.title}`}>
        <header><button type="button" onClick={onCancel}>取消</button><h2>{log ? "编辑记录" : "记录这一次"}</h2><button type="submit">保存</button></header>
        <div className="editor-content">
          <div className="selected-problem surface">
            <span className={difficultyMeta[problem.difficulty].className}>#{problem.number} · {problem.difficulty}</span>
            <strong>{problem.title}</strong>
          </div>
          <fieldset><legend>本次状态</legend><div className="surface form-surface"><Segmented values={["待复习", "巩固中", "已掌握"] as Mastery[]} value={status} onChange={setStatus} /></div></fieldset>
          <fieldset><legend>本次记录</legend><div className="surface form-surface">
            <label className="form-row"><span>完成时间</span><input type="datetime-local" value={solvedAt} onChange={(event) => setSolvedAt(event.target.value)} /></label>
            <NumberStepper label="用时" value={duration} unit="分钟" min={1} max={300} step={5} onChange={setDuration} />
            <NumberStepper label="尝试次数" value={attempts} unit="次" min={1} max={20} step={1} onChange={setAttempts} />
          </div></fieldset>
          <fieldset><legend>标签</legend><input className="standalone-input" placeholder="数组，双指针，动态规划" value={tags} onChange={(event) => setTags(event.target.value)} /><small>使用逗号分隔多个标签</small></fieldset>
          <fieldset><legend>解题笔记</legend><textarea placeholder="记录思路、踩坑点或下次复习重点…" value={note} onChange={(event) => setNote(event.target.value)} rows={5} /></fieldset>
          <label className="favorite-toggle surface"><span>◆ 加入重点收藏</span><input type="checkbox" checked={isFavorite} onChange={(event) => setIsFavorite(event.target.checked)} /></label>
        </div>
      </form>
    </div>
  );
}

function Segmented<T extends string>({ values, value, onChange }: { values: T[]; value: T; onChange: (value: T) => void }) {
  return <div className="segmented">{values.map((item) => <button type="button" key={item} className={value === item ? "active" : ""} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function NumberStepper({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <div className="form-row"><span>{label}</span><div className="inline-stepper"><button type="button" onClick={() => onChange(Math.max(min, value - step))}>−</button><strong>{value} {unit}</strong><button type="button" onClick={() => onChange(Math.min(max, value + step))}>＋</button></div></div>;
}
