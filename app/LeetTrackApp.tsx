"use client";

import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Difficulty = "简单" | "中等" | "困难";
type Mastery = "待复习" | "巩固中" | "已掌握";
type Tab = "today" | "library" | "insights" | "settings";
type Appearance = "system" | "light" | "dark";

type Problem = {
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

type Backup = {
  version: 1;
  exportedAt: string;
  weeklyGoal: number;
  problems: Problem[];
};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STORAGE_KEY = "leet-track-problems-v1";
const GOAL_KEY = "leet-track-weekly-goal";
const APPEARANCE_KEY = "leet-track-appearance";
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

function daysAgo(days: number, hour = 20) {
  const date = new Date(Date.now() - days * DAY);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function sampleProblems(): Problem[] {
  return [
    {
      id: crypto.randomUUID(),
      number: "1",
      title: "两数之和",
      difficulty: "简单",
      status: "已掌握",
      tags: ["数组", "哈希表"],
      solvedAt: daysAgo(0),
      duration: 18,
      attempts: 1,
      note: "用哈希表记录已经遍历过的值，时间复杂度 O(n)。",
      favorite: true,
    },
    {
      id: crypto.randomUUID(),
      number: "3",
      title: "无重复字符的最长子串",
      difficulty: "中等",
      status: "巩固中",
      tags: ["字符串", "滑动窗口"],
      solvedAt: daysAgo(1),
      duration: 42,
      attempts: 2,
      note: "右指针扩张，遇到重复字符时移动左指针。",
      favorite: true,
    },
    {
      id: crypto.randomUUID(),
      number: "206",
      title: "反转链表",
      difficulty: "简单",
      status: "已掌握",
      tags: ["链表", "递归"],
      solvedAt: daysAgo(2),
      duration: 16,
      attempts: 1,
      note: "迭代和递归两种写法都要熟悉。",
      favorite: false,
    },
    {
      id: crypto.randomUUID(),
      number: "15",
      title: "三数之和",
      difficulty: "中等",
      status: "待复习",
      tags: ["数组", "双指针", "排序"],
      solvedAt: daysAgo(4),
      duration: 55,
      attempts: 3,
      note: "排序后固定一个数，注意跳过重复值。",
      favorite: false,
    },
    {
      id: crypto.randomUUID(),
      number: "42",
      title: "接雨水",
      difficulty: "困难",
      status: "待复习",
      tags: ["栈", "双指针"],
      solvedAt: daysAgo(6),
      duration: 68,
      attempts: 4,
      note: "先理解左右最大高度，再尝试双指针优化。",
      favorite: false,
    },
  ];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
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

export function LeetTrackApp() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [weeklyGoal, setWeeklyGoal] = useState(7);
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [editorProblem, setEditorProblem] = useState<Problem | null | undefined>();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setProblems(saved ? (JSON.parse(saved) as Problem[]) : sampleProblems());
      setWeeklyGoal(Number(localStorage.getItem(GOAL_KEY)) || 7);
      setAppearance((localStorage.getItem(APPEARANCE_KEY) as Appearance) || "system");
    } catch {
      setProblems(sampleProblems());
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(problems));
    localStorage.setItem(GOAL_KEY, String(weeklyGoal));
    localStorage.setItem(APPEARANCE_KEY, appearance);
  }, [appearance, hydrated, problems, weeklyGoal]);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  const sorted = useMemo(
    () => [...problems].sort((a, b) => +new Date(b.solvedAt) - +new Date(a.solvedAt)),
    [problems],
  );

  function saveProblem(problem: Problem) {
    setProblems((current) => {
      const exists = current.some((item) => item.id === problem.id);
      return exists
        ? current.map((item) => (item.id === problem.id ? problem : item))
        : [...current, problem];
    });
    setEditorProblem(undefined);
  }

  function removeProblem(problem: Problem) {
    if (window.confirm(`删除“${problem.title}”及其笔记？`)) {
      setProblems((current) => current.filter((item) => item.id !== problem.id));
    }
  }

  function toggleFavorite(problem: Problem) {
    setProblems((current) =>
      current.map((item) =>
        item.id === problem.id ? { ...item, favorite: !item.favorite } : item,
      ),
    );
  }

  function exportBackup() {
    const backup: Backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      weeklyGoal,
      problems,
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
      const backup = JSON.parse(await file.text()) as Backup;
      if (!Array.isArray(backup.problems)) throw new Error("invalid");
      setProblems(backup.problems);
      setWeeklyGoal(Number(backup.weeklyGoal) || 7);
      window.alert(`已恢复 ${backup.problems.length} 道题。`);
    } catch {
      window.alert("这个备份文件无法读取，请选择从题迹导出的 JSON 文件。 ");
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
            problems={sorted}
            weeklyGoal={weeklyGoal}
            onAdd={() => setEditorProblem(null)}
            onEdit={setEditorProblem}
          />
        )}
        {tab === "library" && (
          <Library
            problems={sorted}
            onAdd={() => setEditorProblem(null)}
            onEdit={setEditorProblem}
            onDelete={removeProblem}
            onFavorite={toggleFavorite}
          />
        )}
        {tab === "insights" && <Insights problems={problems} />}
        {tab === "settings" && (
          <Settings
            problems={problems}
            weeklyGoal={weeklyGoal}
            appearance={appearance}
            installPromptAvailable={Boolean(installPrompt)}
            onGoalChange={setWeeklyGoal}
            onAppearanceChange={setAppearance}
            onInstall={installApp}
            onExport={exportBackup}
            onImport={() => importRef.current?.click()}
            onRestore={() => {
              if (window.confirm("用示例数据替换当前全部记录？")) setProblems(sampleProblems());
            }}
            onClear={() => {
              if (window.confirm("清空所有题目和笔记？这个操作无法撤销。")) setProblems([]);
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

      {editorProblem !== undefined && (
        <ProblemEditor
          key={editorProblem?.id ?? "new"}
          problem={editorProblem}
          onCancel={() => setEditorProblem(undefined)}
          onSave={saveProblem}
        />
      )}
    </main>
  );
}

function TabButton({
  current,
  value,
  label,
  icon,
  onSelect,
}: {
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

function PageHeader({
  eyebrow,
  title,
  onAdd,
}: {
  eyebrow?: string;
  title: string;
  onAdd?: () => void;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {onAdd && (
        <button className="add-button" onClick={onAdd} aria-label="记录一道题">＋</button>
      )}
    </header>
  );
}

function Dashboard({
  problems,
  weeklyGoal,
  onAdd,
  onEdit,
}: {
  problems: Problem[];
  weeklyGoal: number;
  onAdd: () => void;
  onEdit: (problem: Problem) => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const weekStart = startOfWeek(new Date());
  const solvedThisWeek = problems.filter((item) => new Date(item.solvedAt) >= weekStart).length;
  const progress = Math.min(solvedThisWeek / weeklyGoal, 1);
  const streak = getStreak(problems);
  const mastered = problems.filter((item) => item.status === "已掌握").length;
  const activity = getActivity(problems);

  return (
    <section className="page">
      <PageHeader eyebrow={greeting} title="今天，继续向前一题。" onAdd={onAdd} />

      <article className="goal-panel">
        <div>
          <p className="panel-kicker">◎ 本周目标</p>
          <strong>{solvedThisWeek} <span>/ {weeklyGoal}</span></strong>
          <p>{solvedThisWeek >= weeklyGoal ? "目标达成，漂亮！" : `再完成 ${weeklyGoal - solvedThisWeek} 题即可达标`}</p>
        </div>
        <div
          className="progress-ring"
          style={{ "--progress": `${progress * 360}deg` } as CSSProperties}
          role="img"
          aria-label={`本周目标完成 ${Math.round(progress * 100)}%`}
        >
          <span>{Math.round(progress * 100)}%</span>
        </div>
      </article>

      <div className="metric-line" aria-label="刷题概览">
        <Metric value={problems.length} label="累计题数" />
        <Metric value={streak} label="连续天数" />
        <Metric value={mastered} label="已掌握" />
      </div>

      <article className="surface activity-card">
        <SectionTitle title="最近 7 天" detail={`共 ${activity.reduce((sum, day) => sum + day.count, 0)} 题`} />
        <ActivityChart activity={activity} />
      </article>

      <article className="surface recent-card">
        <SectionTitle title="最近记录" detail={`${problems.length} 题`} />
        {problems.length === 0 ? (
          <EmptyState title="从第一题开始" detail="点击右上角加号，记录你的第一道题。" />
        ) : (
          problems.slice(0, 4).map((problem) => (
            <ProblemRow key={problem.id} problem={problem} onClick={() => onEdit(problem)} />
          ))
        )}
      </article>
    </section>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function getActivity(problems: Problem[]) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      date,
      count: problems.filter((item) => localDateKey(item.solvedAt) === localDateKey(date)).length,
    };
  });
}

function getStreak(problems: Problem[]) {
  const days = new Set(problems.map((problem) => localDateKey(problem.solvedAt)));
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
          <div className="bar-track">
            <div
              className={localDateKey(item.date) === localDateKey(new Date()) ? "bar today" : "bar"}
              style={{ height: item.count ? `${Math.max(16, (item.count / max) * 100)}%` : "6px" }}
            />
          </div>
          <span>{new Intl.DateTimeFormat("zh-CN", { weekday: "narrow" }).format(item.date)}</span>
        </div>
      ))}
    </div>
  );
}

function ProblemRow({ problem, onClick }: { problem: Problem; onClick: () => void }) {
  const meta = difficultyMeta[problem.difficulty];
  return (
    <button className="problem-row" onClick={onClick}>
      <span className={`problem-mark ${meta.className}`}>{statusMark[problem.status]}</span>
      <span className="problem-copy">
        <strong><small>{problem.number ? `#${problem.number}` : "—"}</small>{problem.title}</strong>
        <span><b className={meta.className}>{problem.difficulty}</b> · {problem.status} · {formatDate(problem.solvedAt)}</span>
      </span>
      {problem.favorite && <span className="bookmark" aria-label="已收藏">◆</span>}
      <span className="chevron" aria-hidden="true">›</span>
    </button>
  );
}

function Library({
  problems,
  onAdd,
  onEdit,
  onDelete,
  onFavorite,
}: {
  problems: Problem[];
  onAdd: () => void;
  onEdit: (problem: Problem) => void;
  onDelete: (problem: Problem) => void;
  onFavorite: (problem: Problem) => void;
}) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "全部">("全部");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const filtered = problems.filter((problem) => {
    const text = `${problem.number} ${problem.title} ${problem.tags.join(" ")}`.toLowerCase();
    return (
      text.includes(query.trim().toLowerCase()) &&
      (difficulty === "全部" || problem.difficulty === difficulty) &&
      (!favoritesOnly || problem.favorite)
    );
  });

  return (
    <section className="page library-page">
      <PageHeader title="我的题库" onAdd={onAdd} />
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题号、名称或标签" />
      </label>
      <div className="filter-row" aria-label="题库筛选">
        {(["全部", "简单", "中等", "困难"] as const).map((item) => (
          <button
            key={item}
            className={difficulty === item ? "filter active" : "filter"}
            onClick={() => setDifficulty(item)}
          >
            {item}
          </button>
        ))}
        <button className={favoritesOnly ? "filter favorite active" : "filter favorite"} onClick={() => setFavoritesOnly(!favoritesOnly)}>◆ 收藏</button>
      </div>
      <div className="library-count">{filtered.length} 条记录</div>
      {filtered.length === 0 ? (
        <EmptyState title="没有找到匹配题目" detail="换个题号、名称或标签试试。" />
      ) : (
        <div className="library-list surface">
          {filtered.map((problem) => (
            <div className="library-item" key={problem.id}>
              <ProblemRow problem={problem} onClick={() => onEdit(problem)} />
              <div className="row-actions">
                <button onClick={() => onFavorite(problem)}>{problem.favorite ? "取消收藏" : "收藏"}</button>
                <button className="danger-link" onClick={() => onDelete(problem)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Insights({ problems }: { problems: Problem[] }) {
  const counts: Record<Difficulty, number> = { 简单: 0, 中等: 0, 困难: 0 };
  const tags = new Map<string, number>();
  let totalMinutes = 0;
  problems.forEach((problem) => {
    counts[problem.difficulty] += 1;
    totalMinutes += problem.duration;
    problem.tags.forEach((tag) => tags.set(tag, (tags.get(tag) ?? 0) + 1));
  });
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topCount = Math.max(topTags[0]?.[1] ?? 1, 1);
  const total = Math.max(problems.length, 1);
  const easyDeg = (counts.简单 / total) * 360;
  const mediumDeg = (counts.中等 / total) * 360;

  return (
    <section className="page">
      <PageHeader title="统计" />
      {problems.length === 0 ? (
        <EmptyState title="数据正在等待第一题" detail="记录题目后，这里会展示你的练习趋势。" />
      ) : (
        <>
          <div className="metric-line insights-metrics">
            <Metric value={problems.length} label="累计完成" />
            <div className="duration-metric"><strong>{totalMinutes >= 60 ? `${(totalMinutes / 60).toFixed(1)}h` : `${totalMinutes}m`}</strong><span>累计投入</span></div>
          </div>
          <article className="surface insight-card">
            <SectionTitle title="难度分布" />
            <div className="donut-layout">
              <div
                className="donut"
                style={{ background: `conic-gradient(var(--easy) 0 ${easyDeg}deg, var(--medium) ${easyDeg}deg ${easyDeg + mediumDeg}deg, var(--hard) ${easyDeg + mediumDeg}deg 360deg)` }}
              >
                <div><strong>{problems.length}</strong><span>题</span></div>
              </div>
              <div className="legend">
                {(["简单", "中等", "困难"] as Difficulty[]).map((item) => (
                  <div key={item}><i className={difficultyMeta[item].className} /><span>{item}</span><strong>{counts[item]}</strong></div>
                ))}
              </div>
            </div>
          </article>
          <article className="surface insight-card">
            <SectionTitle title="活跃趋势" detail="近 7 天" />
            <ActivityChart activity={getActivity(problems)} />
          </article>
          <article className="surface insight-card">
            <SectionTitle title="高频标签" detail="TOP 5" />
            {topTags.length === 0 ? <p className="muted-copy">记录标签后，这里会显示你的练习重点。</p> : (
              <div className="tag-stats">
                {topTags.map(([tag, count], index) => (
                  <div key={tag}>
                    <p><strong>{tag}</strong><span>{count} 题</span></p>
                    <div><i className={index === 0 ? "top" : ""} style={{ width: `${(count / topCount) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}

function Settings({
  problems,
  weeklyGoal,
  appearance,
  installPromptAvailable,
  onGoalChange,
  onAppearanceChange,
  onInstall,
  onExport,
  onImport,
  onRestore,
  onClear,
}: {
  problems: Problem[];
  weeklyGoal: number;
  appearance: Appearance;
  installPromptAvailable: boolean;
  onGoalChange: (goal: number) => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onInstall: () => void;
  onExport: () => void;
  onImport: () => void;
  onRestore: () => void;
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
      <SettingsGroup title="目标">
        <div className="settings-row">
          <span>每周完成</span>
          <div className="stepper">
            <button onClick={() => onGoalChange(Math.max(1, weeklyGoal - 1))} aria-label="减少每周目标">−</button>
            <strong>{weeklyGoal} 题</strong>
            <button onClick={() => onGoalChange(Math.min(30, weeklyGoal + 1))} aria-label="增加每周目标">＋</button>
          </div>
        </div>
      </SettingsGroup>
      <SettingsGroup title="外观">
        <div className="appearance-options">
          {([ ["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"] ] as [Appearance, string][]).map(([value, label]) => (
            <button key={value} className={appearance === value ? "active" : ""} onClick={() => onAppearanceChange(value)}>{label}</button>
          ))}
        </div>
      </SettingsGroup>
      <SettingsGroup title="数据">
        <div className="settings-row"><span>当前记录</span><strong>{problems.length} 题</strong></div>
        <button className="full-row-button" onClick={onExport}>导出备份 <span>›</span></button>
        <button className="full-row-button" onClick={onImport}>导入备份 <span>›</span></button>
        <button className="full-row-button" onClick={onRestore}>恢复示例数据 <span>›</span></button>
        <button className="full-row-button danger-link" onClick={onClear} disabled={!problems.length}>清空全部记录 <span>›</span></button>
      </SettingsGroup>
      <p className="privacy-note"><strong>数据只属于你</strong><br />所有记录保存在当前设备。清除 Safari 网站数据前，请先导出备份。</p>
    </section>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="settings-group"><h2>{title}</h2><div className="surface">{children}</div></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span>＋</span><strong>{title}</strong><p>{detail}</p></div>;
}

function ProblemEditor({
  problem,
  onCancel,
  onSave,
}: {
  problem: Problem | null;
  onCancel: () => void;
  onSave: (problem: Problem) => void;
}) {
  const [number, setNumber] = useState(problem?.number ?? "");
  const [title, setTitle] = useState(problem?.title ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(problem?.difficulty ?? "中等");
  const [status, setStatus] = useState<Mastery>(problem?.status ?? "待复习");
  const [solvedAt, setSolvedAt] = useState(inputDate(problem?.solvedAt ?? new Date().toISOString()));
  const [duration, setDuration] = useState(problem?.duration ?? 30);
  const [attempts, setAttempts] = useState(problem?.attempts ?? 1);
  const [tags, setTags] = useState(problem?.tags.join("，") ?? "");
  const [note, setNote] = useState(problem?.note ?? "");
  const [favorite, setFavorite] = useState(problem?.favorite ?? false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onSave({
      id: problem?.id ?? crypto.randomUUID(),
      number: number.trim(),
      title: title.trim(),
      difficulty,
      status,
      solvedAt: new Date(solvedAt).toISOString(),
      duration,
      attempts,
      tags: [...new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))],
      note: note.trim(),
      favorite,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="editor-sheet" onSubmit={submit}>
        <header><button type="button" onClick={onCancel}>取消</button><h2>{problem ? "编辑记录" : "记录一道题"}</h2><button type="submit" disabled={!title.trim()}>保存</button></header>
        <div className="editor-content">
          <fieldset><legend>题目信息</legend><div className="surface form-surface">
            <div className="split-input"><input inputMode="numeric" placeholder="题号" value={number} onChange={(event) => setNumber(event.target.value)} /><input autoFocus placeholder="题目名称" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
            <Segmented values={["简单", "中等", "困难"] as Difficulty[]} value={difficulty} onChange={setDifficulty} />
            <label className="form-row"><span>掌握程度</span><select value={status} onChange={(event) => setStatus(event.target.value as Mastery)}><option>待复习</option><option>巩固中</option><option>已掌握</option></select></label>
          </div></fieldset>
          <fieldset><legend>本次记录</legend><div className="surface form-surface">
            <label className="form-row"><span>完成时间</span><input type="datetime-local" value={solvedAt} onChange={(event) => setSolvedAt(event.target.value)} /></label>
            <NumberStepper label="用时" value={duration} unit="分钟" min={1} max={300} step={5} onChange={setDuration} />
            <NumberStepper label="尝试次数" value={attempts} unit="次" min={1} max={20} step={1} onChange={setAttempts} />
          </div></fieldset>
          <fieldset><legend>标签</legend><input className="standalone-input" placeholder="数组，双指针，动态规划" value={tags} onChange={(event) => setTags(event.target.value)} /><small>使用逗号分隔多个标签</small></fieldset>
          <fieldset><legend>解题笔记</legend><textarea placeholder="记录思路、踩坑点或下次复习重点…" value={note} onChange={(event) => setNote(event.target.value)} rows={5} /></fieldset>
          <label className="favorite-toggle surface"><span>◆ 加入重点收藏</span><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /></label>
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
