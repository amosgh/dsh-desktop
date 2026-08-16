import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopTaskSummary, GitReviewSnapshot, PendingApproval, PendingQuestion, ProjectRecord, ProtocolSnapshot, SettingsSnapshot, SidecarPhase, SidecarSnapshot, TaskTimelineSnapshot, TimelineItem } from "../shared/contracts";

const INITIAL: SidecarSnapshot = {
  phase: "idle",
  harnessVersion: "0.1.0-rc.6",
  logs: [],
  adapter: { phase: "locked", protocolVersion: "1", authenticated: false },
};

const INITIAL_PROTOCOL: ProtocolSnapshot = {
  phase: "disconnected",
  generation: 0,
  tasks: [],
  approvals: [],
  questions: [],
};

const PHASE_LABEL: Record<SidecarPhase, string> = {
  idle: "尚未启动",
  starting: "正在启动",
  ready: "运行正常",
  stopping: "正在停止",
  stopped: "已停止",
  error: "启动失败",
};

function StatusMark({ phase }: { phase: SidecarPhase }) {
  return <span className={`status-mark status-mark--${phase}`} aria-hidden="true" />;
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="runtime-detail">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatRecent(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

interface ProjectsViewProps {
  projects: ProjectRecord[];
  busy: boolean;
  error?: string;
  onChoose(): void;
  onActivate(id: string): void;
  onReveal(id: string): void;
  onRemove(id: string): void;
}

function ProjectsView({ projects, busy, error, onChoose, onActivate, onReveal, onRemove }: ProjectsViewProps) {
  const active = projects.find((project) => project.active);
  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <p className="context-line">已授权的本机目录</p>
          <h1>项目</h1>
        </div>
        <button className="button button--primary" type="button" onClick={onChoose} disabled={busy}>
          添加项目…
        </button>
      </header>

      <section className="projects-intro" aria-labelledby="projects-title">
        <div>
          <h2 id="projects-title">代码仓库</h2>
          <p>只有经原生目录选择器授权的 Git 仓库才能成为 Harness 工作区。</p>
        </div>
        <span>{active ? `当前：${active.name}` : "尚未选择工作区"}</span>
      </section>

      {error && (
        <section className="error-banner" role="alert">
          <strong>项目操作未完成</strong>
          <p>{error}</p>
        </section>
      )}

      {projects.length === 0 ? (
        <section className="projects-empty">
          <span className="folder-mark" aria-hidden="true">⌘</span>
          <div>
            <h2>添加第一个代码仓库</h2>
            <p>DSH Desktop 会保存规范化后的仓库根路径；不会复制、移动或上传代码。</p>
          </div>
          <button className="button button--secondary" type="button" onClick={onChoose} disabled={busy}>
            选择 Git 仓库…
          </button>
        </section>
      ) : (
        <section className="project-list" aria-label="已授权项目">
          {projects.map((project) => (
            <article className={`project-row${project.active ? " project-row--active" : ""}`} key={project.id}>
              <div className="project-identity">
                <span className="project-glyph" aria-hidden="true">⌘</span>
                <div>
                  <div className="project-name-line">
                    <h2>{project.name}</h2>
                    {project.active && <span className="active-label">当前工作区</span>}
                  </div>
                  <p title={project.path}>{project.path}</p>
                  <span>最近使用 {formatRecent(project.lastOpenedAt)}</span>
                </div>
              </div>
              <div className="project-actions">
                {!project.active && (
                  <button className="button button--secondary" type="button" onClick={() => onActivate(project.id)} disabled={busy}>
                    设为当前
                  </button>
                )}
                <button className="project-action" type="button" onClick={() => onReveal(project.id)} disabled={busy}>
                  Finder
                </button>
                <button className="project-action project-action--danger" type="button" onClick={() => onRemove(project.id)} disabled={busy}>
                  移除
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <footer className="workspace-footer">
        <span>项目授权仅保存在这台 Mac</span>
        <span>{projects.length} 个项目</span>
      </footer>
    </main>
  );
}

interface TasksViewProps {
  protocol: ProtocolSnapshot;
  activeProject?: ProjectRecord;
  busy: boolean;
  error?: string;
  focusComposer: number;
  onCreate(prompt: string): Promise<boolean>;
  onSend(sessionId: string, prompt: string, mode: "queue" | "steer"): Promise<boolean>;
  onRename(sessionId: string, title: string): Promise<boolean>;
  onFork(sessionId: string, atSeq?: number): Promise<string | undefined>;
  onArchive(sessionId: string): Promise<boolean>;
  onCancel(sessionId: string): void;
  onRefresh(): void;
  onChooseProject(): void;
  onOpenHarness(): void;
  openSessionId?: string;
  onOpenedSession(): void;
}

const PROTOCOL_LABEL: Record<ProtocolSnapshot["phase"], string> = {
  disconnected: "未连接",
  connecting: "正在连接",
  connected: "事件流已连接",
  recovering: "正在恢复",
  error: "连接异常",
};

function taskStatus(task: DesktopTaskSummary): string {
  return task.pendingApprovals > 0 ? `等待 ${task.pendingApprovals} 项授权` : task.running ? "运行中" : task.readyForReview ? "待审阅" : task.blank ? "尚未开始" : "已停止";
}

function approvalPresentation(approval: PendingApproval): { action: string; risk: string } {
  const name = approval.toolName.toLowerCase();
  if (/bash|shell|pwsh|command|terminal/.test(name)) return { action: "执行本机命令", risk: "命令可能读取或修改当前工作区" };
  if (/web|http|network|fetch/.test(name)) return { action: "访问网络", risk: "数据可能发送到外部地址" };
  if (/write|edit|replace|delete|move|mkdir/.test(name)) return { action: "修改文件", risk: "将改变项目中的本机文件" };
  if (/read|search|list|glob/.test(name)) return { action: "读取工作区", risk: "只读取已授权项目范围" };
  return { action: `运行 ${approval.toolName}`, risk: "Harness 请求执行受保护操作" };
}

function ApprovalCard({ approval, task, onRespond }: { approval: PendingApproval; task?: DesktopTaskSummary; onRespond(outcome: "allowed-once" | "rejected"): void }) {
  const presentation = approvalPresentation(approval);
  return (
    <article className="inbox-card approval-card">
      <header>
        <span className="inbox-kind inbox-kind--approval">需要授权</span>
        <span>{task?.title ?? `任务 ${approval.sessionId.slice(0, 8)}`}</span>
      </header>
      <h2>{presentation.action}</h2>
      <p>{approval.reason ?? presentation.risk}</p>
      <dl className="approval-facts">
        <div><dt>工具</dt><dd>{approval.toolName}</dd></div>
        <div><dt>范围</dt><dd>{task?.cwd ?? "当前 Harness 工作区"}</dd></div>
      </dl>
      {approval.detail && <details className="approval-detail"><summary>查看准确参数</summary><pre>{approval.detail}</pre></details>}
      <footer>
        <span>{presentation.risk}</span>
        <div>
          <button className="button button--secondary" type="button" disabled={approval.state === "resolving"} onClick={() => onRespond("rejected")}>拒绝</button>
          <button className="button button--primary" type="button" disabled={approval.state === "resolving"} onClick={() => onRespond("allowed-once")}>{approval.state === "resolving" ? "正在提交…" : "仅允许这一次"}</button>
        </div>
      </footer>
    </article>
  );
}

function QuestionCard({ request, task, onSubmit }: { request: PendingQuestion; task?: DesktopTaskSummary; onSubmit(answers: Array<{ id: string; selected: string[]; custom?: string }>): void }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const complete = request.questions.every((question) => (selected[question.id]?.length ?? 0) > 0 || Boolean(custom[question.id]?.trim()));
  function toggle(questionId: string, label: string, multi: boolean) {
    setSelected((current) => {
      if (!multi) return { ...current, [questionId]: [label] };
      const values = current[questionId] ?? [];
      return { ...current, [questionId]: values.includes(label) ? values.filter((value) => value !== label) : [...values, label] };
    });
  }
  return (
    <article className="inbox-card question-card">
      <header>
        <span className="inbox-kind inbox-kind--question">需要回答</span>
        <span>{task?.title ?? `任务 ${request.sessionId.slice(0, 8)}`}</span>
      </header>
      {request.questions.map((question) => (
        <fieldset key={question.id}>
          <legend>{question.header && <small>{question.header}</small>}{question.question}</legend>
          {question.detail && <p>{question.detail}</p>}
          <div className="question-options">
            {question.options.map((option) => (
              <label key={option.label}>
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={question.id}
                  checked={(selected[question.id] ?? []).includes(option.label)}
                  onChange={() => toggle(question.id, option.label, question.multiSelect)}
                />
                <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              </label>
            ))}
          </div>
          {!question.intent && (
            <input className="question-custom" value={custom[question.id] ?? ""} onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="其他回答…" />
          )}
        </fieldset>
      ))}
      <footer>
        <span>回答会继续当前任务</span>
        <button className="button button--primary" type="button" disabled={!complete || request.state === "resolving"} onClick={() => onSubmit(request.questions.map((question) => ({ id: question.id, selected: selected[question.id] ?? [], ...(custom[question.id]?.trim() ? { custom: custom[question.id].trim() } : {}) })))}>
          {request.state === "resolving" ? "正在提交…" : "提交回答"}
        </button>
      </footer>
    </article>
  );
}

function InboxView({ protocol, error, onApproval, onQuestion, onOpenTask }: {
  protocol: ProtocolSnapshot;
  error?: string;
  onApproval(approvalId: string, outcome: "allowed-once" | "rejected"): void;
  onQuestion(requestId: string, answers: Array<{ id: string; selected: string[]; custom?: string }>): void;
  onOpenTask?(sessionId: string): void;
}) {
  const readyTasks = protocol.tasks.filter((task) => task.readyForReview && task.worktreeBranch && !task.archived && !task.error);
  const count = protocol.approvals.length + protocol.questions.length + readyTasks.length;
  return (
    <main className="workspace">
      <header className="workspace-header"><div><p className="context-line">需要你决定的事项</p><h1>待处理</h1></div><span className="inbox-count">{count} 项</span></header>
      <section className="inbox-intro"><div><h2>决策中心</h2><p>授权只对当前请求生效；这里不会静默修改持久权限策略。</p></div><span>{protocol.phase === "connected" ? "实时同步" : PROTOCOL_LABEL[protocol.phase]}</span></section>
      {error && <section className="error-banner" role="alert"><strong>操作未完成</strong><p>{error}</p></section>}
      {count === 0 ? (
        <section className="inbox-empty"><span aria-hidden="true">✓</span><h2>目前没有待处理事项</h2><p>需要授权、回答或计划确认的任务会集中出现在这里。</p></section>
      ) : (
        <section className="inbox-list" aria-live="polite">
          {protocol.approvals.map((approval) => <ApprovalCard approval={approval} task={protocol.tasks.find((task) => task.sessionId === approval.sessionId)} onRespond={(outcome) => onApproval(approval.approvalId, outcome)} key={approval.approvalId} />)}
          {protocol.questions.map((question) => <QuestionCard request={question} task={protocol.tasks.find((task) => task.sessionId === question.sessionId)} onSubmit={(answers) => onQuestion(question.requestId, answers)} key={question.requestId} />)}
          {readyTasks.map((task) => <article className="inbox-card review-ready-card" key={task.sessionId}><header><span className="inbox-kind inbox-kind--review">待审阅</span><span>{task.worktreeBranch ?? task.sessionId.slice(0, 8)}</span></header><h2>{task.title}</h2><p>Harness 已结束当前运行。检查文件变化和测试结果后，可以提交、继续任务或丢弃隔离工作区。</p><footer><span>{new Date(task.updatedAt).toLocaleString("zh-CN")}</span><button className="button button--primary" type="button" onClick={() => onOpenTask?.(task.sessionId)}>审阅变更</button></footer></article>)}
        </section>
      )}
      <footer className="workspace-footer"><span>决策由 Harness 记录到会话审计日志</span><span>不会重复提交已解决请求</span></footer>
    </main>
  );
}

function SettingsView({ runtime, protocol }: { runtime: SidecarSnapshot; protocol: ProtocolSnapshot }) {
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [editor, setEditor] = useState<"vscode" | "system">("vscode");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();

  useEffect(() => {
    void window.dshDesktop.getSettings().then((value) => {
      setSettings(value); setBaseURL(value.baseURL); setModel(value.model); setEditor(value.editor);
    });
  }, []);

  async function testConnection() {
    setBusy(true); setMessage(undefined);
    const result = await window.dshDesktop.testModelConnection({ ...(apiKey.trim() ? { apiKey } : {}), baseURL });
    setMessage(result.ok ? { kind: "success", text: `连接成功，服务返回 ${result.models.length} 个可用模型。` } : { kind: "error", text: result.error });
    setBusy(false);
  }

  async function save() {
    setBusy(true); setMessage(undefined);
    const result = await window.dshDesktop.saveSettings({ ...(apiKey.trim() ? { apiKey } : {}), baseURL, model, editor });
    if (result.ok) { setSettings(result.settings); setApiKey(""); setMessage({ kind: "success", text: "设置已保存，Harness 正在使用新配置重启。" }); }
    else setMessage({ kind: "error", text: result.error });
    setBusy(false);
  }

  async function clearKey() {
    setBusy(true); setMessage(undefined);
    const result = await window.dshDesktop.saveSettings({ clearApiKey: true, baseURL, model, editor });
    if (result.ok) { setSettings(result.settings); setApiKey(""); setMessage({ kind: "success", text: "已从安全存储中移除 API Key。" }); }
    else setMessage({ kind: "error", text: result.error });
    setBusy(false);
  }

  async function exportDiagnostics() {
    setBusy(true); setMessage(undefined);
    const result = await window.dshDesktop.exportDiagnostics();
    if (result.ok) setMessage({ kind: "success", text: `诊断信息已导出到 ${result.path}` });
    else if (!result.cancelled) setMessage({ kind: "error", text: result.error ?? "导出失败。" });
    setBusy(false);
  }

  return (
    <main className="workspace settings-workspace">
      <header className="workspace-header"><div><p className="context-line">本机配置</p><h1>设置</h1></div><span className={`settings-health settings-health--${settings?.credentialConfigured ? "ready" : "missing"}`}>{settings?.credentialConfigured ? "凭证已配置" : "需要 API Key"}</span></header>
      {message && <section className={`settings-message settings-message--${message.kind}`} role="status">{message.text}</section>}
      <section className="settings-section" aria-labelledby="models-settings"><header><h2 id="models-settings">模型与凭证</h2><p>密钥由 macOS 钥匙串支持的安全存储保护，界面不会读回或显示已有值。</p></header><div className="settings-form">
        <label><span>DeepSeek API Key</span><div className="secret-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder={settings?.credentialConfigured ? "已配置；留空则保持不变" : "输入 API Key"} />{settings?.credentialConfigured && <button type="button" onClick={() => void clearKey()} disabled={busy}>移除</button>}</div></label>
        <label><span>API 端点</span><input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} spellCheck={false} /></label>
        <label><span>默认模型</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="deepseek-v4-flash">DeepSeek-V4-Flash</option><option value="deepseek-v4-pro">DeepSeek-V4-Pro</option></select></label>
        <div className="settings-form-actions"><button className="button button--secondary" type="button" onClick={() => void testConnection()} disabled={busy || (!apiKey.trim() && !settings?.credentialConfigured)}>测试连接</button><button className="button button--primary" type="button" onClick={() => void save()} disabled={busy || !baseURL.trim() || !model.trim()}>{busy ? "正在处理…" : "保存并重启 Harness"}</button></div>
      </div></section>
      <section className="settings-section" aria-labelledby="workspace-settings"><header><h2 id="workspace-settings">工作区与外部工具</h2><p>新任务默认使用从当前 HEAD 创建的独立 Git worktree。</p></header><div className="settings-form"><label><span>外部编辑器</span><select value={editor} onChange={(event) => setEditor(event.target.value as "vscode" | "system")}><option value="vscode">Visual Studio Code</option><option value="system">系统默认应用</option></select></label><div className="settings-readonly"><span>任务隔离</span><strong>独立 worktree（默认）</strong></div></div></section>
      <section className="settings-section" aria-labelledby="diagnostic-settings"><header><h2 id="diagnostic-settings">运行时与诊断</h2><p>导出的 JSON 会移除密钥、传输凭证、端点和项目绝对路径。</p></header><div className="diagnostic-grid"><div><span>Harness</span><strong>{PHASE_LABEL[runtime.phase]}</strong></div><div><span>协议</span><strong>{PROTOCOL_LABEL[protocol.phase]} · 代次 {protocol.generation}</strong></div><div><span>版本</span><strong>{runtime.harnessVersion}</strong></div></div><button className="button button--secondary" type="button" onClick={() => void exportDiagnostics()} disabled={busy}>导出诊断信息…</button></section>
      <footer className="workspace-footer"><span>遥测默认关闭</span><span>社区项目 · 非 DeepSeek 官方应用</span></footer>
    </main>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "tool") {
    return (
      <details className={`timeline-tool timeline-tool--${item.toolState ?? "completed"}`}>
        <summary>
          <span className="timeline-tool-mark" aria-hidden="true">{item.toolState === "running" ? "···" : item.toolState === "error" ? "!" : "✓"}</span>
          <span>{item.toolName ?? item.title ?? "工具调用"}</span>
          <small>{item.toolState === "running" ? "执行中" : item.toolState === "error" ? "失败" : "已完成"}</small>
        </summary>
        {item.detail && <pre>{item.detail}</pre>}
      </details>
    );
  }
  if (item.kind === "context") {
    return (
      <details className="timeline-context">
        <summary>{item.title ?? "上下文已更新"}</summary>
        {item.detail && <pre>{item.detail}</pre>}
      </details>
    );
  }
  if (item.kind === "status") return <div className="timeline-status"><span aria-hidden="true" />{item.title}</div>;
  return (
    <article className={`timeline-message timeline-message--${item.kind}${item.partial ? " timeline-message--partial" : ""}`}>
      <header>
        <span>{item.kind === "user" ? "你" : item.kind === "reasoning" ? "思考过程" : "Harness"}</span>
        <time>{new Date(item.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
      </header>
      <p>{item.text}</p>
    </article>
  );
}

const FILE_STATUS_LABEL: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除", renamed: "重命名", untracked: "未跟踪", conflicted: "冲突" };

function ReviewPanel({ sessionId, onDiscarded }: { sessionId: string; onDiscarded(): void }) {
  const [review, setReview] = useState<GitReviewSnapshot>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("完成任务");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    setReview(await window.dshDesktop.getTaskReview(sessionId));
  }

  useEffect(() => { void refresh(); }, [sessionId]);

  async function selectFile(path: string) {
    setSelectedPath(path);
    setDiff("正在载入差异…");
    const result = await window.dshDesktop.getTaskFileDiff(sessionId, path);
    setDiff(result.ok ? result.diff : result.error);
  }

  async function commit() {
    setBusy(true); setError(undefined);
    const result = await window.dshDesktop.commitTask(sessionId, commitMessage);
    if (!result.ok) setError(result.error);
    else { setCommitMessage(""); await refresh(); }
    setBusy(false);
  }

  async function open(target: "finder" | "terminal" | "editor") {
    const result = await window.dshDesktop.openTaskWorkspace(sessionId, target);
    if (!result.ok) setError(result.error);
  }

  async function discard() {
    setBusy(true); setError(undefined);
    const result = await window.dshDesktop.discardTaskWorkspace(sessionId);
    if (!result.ok) setError(result.error);
    else onDiscarded();
    setBusy(false);
  }

  if (!review) return <div className="timeline-skeleton review-loading"><span /><span /><span /></div>;
  if (review.phase !== "ready") return <div className="review-unavailable"><h2>没有隔离工作区</h2><p>{review.error ?? "这个会话不是由 DSH Desktop worktree 创建，仍可在 Harness 中继续。"}</p></div>;
  return (
    <section className="review-panel">
      <header className="review-summary">
        <div><p className="context-line">{review.workspace?.branch}</p><h2>{review.clean ? "工作区没有变更" : `${review.files.length} 个文件发生变化`}</h2></div>
        <div className="diff-stats"><span>+{review.additions}</span><span>−{review.deletions}</span></div>
      </header>
      <div className="review-actions">
        <button type="button" onClick={() => void open("finder")}>Finder</button>
        <button type="button" onClick={() => void open("terminal")}>终端</button>
        <button type="button" onClick={() => void open("editor")}>VS Code</button>
        <button type="button" onClick={() => void refresh()}>刷新</button>
      </div>
      {error && <div className="review-error" role="alert">{error}</div>}
      {!review.clean && (
        <div className="review-browser">
          <aside aria-label="变更文件">
            {review.files.map((file) => (
              <button className={selectedPath === file.path ? "review-file--active" : ""} type="button" onClick={() => void selectFile(file.path)} key={file.path}>
                <span className={`file-status file-status--${file.status}`}>{FILE_STATUS_LABEL[file.status]}</span><span title={file.path}>{file.path}</span>
              </button>
            ))}
          </aside>
          <div className="diff-viewer">
            {selectedPath ? <><header>{selectedPath}</header><pre>{diff}</pre></> : <div><h2>选择文件查看差异</h2><p>显示相对于任务基线提交的统一 diff。</p></div>}
          </div>
        </div>
      )}
      <footer className="review-footer">
        <div className="commit-control"><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="提交说明" /><button className="button button--primary" type="button" onClick={() => void commit()} disabled={busy || review.clean || !commitMessage.trim()}>提交变更</button></div>
        <button className="text-button review-discard" type="button" onClick={() => void discard()} disabled={busy}>丢弃 worktree…</button>
      </footer>
    </section>
  );
}

function TaskDetail({ task, timeline, onBack, onLoadOlder, onReload, onCancel, onOpenHarness, onSend, onRename, onFork, onArchive }: {
  task: DesktopTaskSummary;
  timeline?: TaskTimelineSnapshot;
  onBack(): void;
  onLoadOlder(): void;
  onReload?(): void;
  onCancel(): void;
  onOpenHarness(): void;
  onSend(prompt: string, mode: "queue" | "steer"): Promise<boolean>;
  onRename(title: string): Promise<boolean>;
  onFork(atSeq?: number): Promise<void>;
  onArchive(): Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [detailTab, setDetailTab] = useState<"timeline" | "review">("timeline");
  const loadingFirstPage = !timeline || (timeline.phase === "loading" && timeline.items.length === 0);
  async function submitMessage() {
    if (!message.trim()) return;
    setSending(true);
    if (await onSend(message, task.running ? "steer" : "queue")) setMessage("");
    setSending(false);
  }
  async function submitRename() {
    if (await onRename(title)) setRenaming(false);
  }
  return (
    <main className="workspace task-detail-workspace">
      <header className="task-detail-header">
        <button className="back-button" type="button" onClick={onBack} aria-label="返回任务列表">‹</button>
        <div>
          <p className="context-line">任务 · {task.sessionId.slice(0, 8)}</p>
          {renaming ? (
            <div className="task-title-editor"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} autoFocus onKeyDown={(event) => { if (event.key === "Enter") void submitRename(); if (event.key === "Escape") { setTitle(task.title); setRenaming(false); } }} /><button type="button" onClick={() => void submitRename()}>保存</button></div>
          ) : <h1 title="双击重命名" onDoubleClick={() => setRenaming(true)}>{task.title}</h1>}
        </div>
        <div className="task-detail-actions">
          <span className={`task-detail-state${task.running ? " task-detail-state--running" : ""}`}><i aria-hidden="true" />{taskStatus(task)}</span>
          <button className="button button--secondary" type="button" onClick={onOpenHarness}>在 Harness 中打开</button>
          <button className="project-action" type="button" onClick={() => setRenaming(true)}>重命名</button>
          <button className="project-action" type="button" onClick={() => void onFork(timeline?.items.at(-1)?.seq)}>分叉</button>
          <button className="project-action" type="button" onClick={() => void onArchive()}>归档</button>
          {task.running && <button className="button button--danger" type="button" onClick={onCancel}>停止</button>}
        </div>
      </header>

      <div className="task-tabs" role="tablist" aria-label="任务详情">
        <button role="tab" aria-selected={detailTab === "timeline"} className={detailTab === "timeline" ? "task-tab--active" : ""} type="button" onClick={() => setDetailTab("timeline")}>对话</button>
        <button role="tab" aria-selected={detailTab === "review"} className={detailTab === "review" ? "task-tab--active" : ""} type="button" onClick={() => setDetailTab("review")}>变更审阅</button>
      </div>

      {detailTab === "review" ? <ReviewPanel sessionId={task.sessionId} onDiscarded={onBack} /> : <><section className="timeline" aria-label="任务对话时间线" aria-busy={timeline?.phase === "loading"}>
        {timeline?.hasMore && (
          <button className="load-older" type="button" onClick={onLoadOlder} disabled={timeline.phase === "loading"}>
            {timeline.phase === "loading" ? "正在载入…" : "载入更早记录"}
          </button>
        )}
        {timeline?.plan && timeline.plan.length > 0 && (
          <section className="task-plan" aria-labelledby="task-plan-title">
            <div><h2 id="task-plan-title">执行计划</h2><span>{timeline.plan.filter((item) => item.status === "completed").length}/{timeline.plan.length}</span></div>
            <ol>{timeline.plan.map((item, index) => <li className={`task-plan--${item.status}`} key={`${index}-${item.content}`}><span aria-hidden="true">{item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}</span><p>{item.content}</p></li>)}</ol>
          </section>
        )}
        {loadingFirstPage ? (
          <div className="timeline-skeleton" aria-label="正在载入任务记录"><span /><span /><span /></div>
        ) : timeline?.phase === "error" && timeline.items.length === 0 ? (
          <div className="timeline-empty"><h2>任务记录暂时无法载入</h2><p>{timeline.error}</p><button className="button button--secondary" type="button" onClick={onReload ?? onLoadOlder}>重试</button></div>
        ) : timeline?.items.length ? (
          <div className="timeline-items">{timeline.items.map((item) => <TimelineRow item={item} key={item.id} />)}</div>
        ) : (
          <div className="timeline-empty"><h2>这个任务还没有消息</h2><p>任务开始输出后，消息和工具操作会实时出现在这里。</p></div>
        )}
      </section>
      <section className="continue-composer" aria-label={task.running ? "发送纠偏" : "继续任务"}>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={20_000} placeholder={task.running ? "补充约束或纠正当前方向…" : "继续这个任务…"} onKeyDown={(event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void submitMessage(); } }} />
        <div><span>⌘↵ {task.running ? "排入纠偏消息" : "继续会话"}</span><button className="button button--primary" type="button" disabled={!message.trim() || sending} onClick={() => void submitMessage()}>{sending ? "正在发送…" : task.running ? "发送纠偏" : "继续任务"}</button></div>
      </section>
      </>}
      <footer className="task-detail-footer">
        <span>{timeline?.items.length ?? 0} 条可见记录</span>
        <span>{task.running ? "实时更新中" : "会话记录已同步"}</span>
      </footer>
    </main>
  );
}

function TasksView({ protocol, activeProject, busy, error, focusComposer, onCreate, onSend, onRename, onFork, onArchive, onCancel, onRefresh, onChooseProject, onOpenHarness, openSessionId, onOpenedSession }: TasksViewProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [timeline, setTimeline] = useState<TaskTimelineSnapshot>();
  const [showArchived, setShowArchived] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const tasks = activeProject
    ? protocol.tasks.filter((task) => (task.projectPath ?? task.cwd) === activeProject.path && task.archived === showArchived)
    : [];

  useEffect(() => {
    if (focusComposer > 0) composer.current?.focus();
  }, [focusComposer]);

  useEffect(() => window.dshDesktop.subscribeTaskTimeline((snapshot) => {
    if (snapshot.sessionId === selectedSessionId) setTimeline(snapshot);
  }), [selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId && !tasks.some((task) => task.sessionId === selectedSessionId)) {
      setSelectedSessionId(undefined);
      setTimeline(undefined);
    }
  }, [selectedSessionId, tasks]);

  useEffect(() => {
    if (openSessionId && tasks.some((task) => task.sessionId === openSessionId)) {
      void openTask(openSessionId);
      onOpenedSession();
    }
  }, [openSessionId, tasks]);

  async function openTask(sessionId: string) {
    setSelectedSessionId(sessionId);
    setTimeline(undefined);
    setTimeline(await window.dshDesktop.getTaskTimeline(sessionId));
  }

  async function submit() {
    if (!prompt.trim()) return;
    if (await onCreate(prompt)) setPrompt("");
  }

  const canCreate = protocol.phase === "connected" && Boolean(activeProject) && !busy;
  const selectedTask = tasks.find((task) => task.sessionId === selectedSessionId);
  if (selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        timeline={timeline}
        onBack={() => { setSelectedSessionId(undefined); setTimeline(undefined); }}
        onLoadOlder={() => void window.dshDesktop.loadOlderTaskTimeline(selectedTask.sessionId).then(setTimeline)}
        onReload={() => void window.dshDesktop.getTaskTimeline(selectedTask.sessionId).then(setTimeline)}
        onCancel={() => onCancel(selectedTask.sessionId)}
        onOpenHarness={onOpenHarness}
        onSend={(prompt, mode) => onSend(selectedTask.sessionId, prompt, mode)}
        onRename={(title) => onRename(selectedTask.sessionId, title)}
        onFork={async (atSeq) => { const child = await onFork(selectedTask.sessionId, atSeq); if (child) { setSelectedSessionId(child); setTimeline(undefined); } }}
        onArchive={async () => { if (await onArchive(selectedTask.sessionId)) { setSelectedSessionId(undefined); setTimeline(undefined); } }}
      />
    );
  }
  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <p className="context-line">{activeProject ? activeProject.name : "尚未选择项目"}</p>
          <h1>任务</h1>
        </div>
        <button className="button button--secondary" type="button" onClick={onRefresh} disabled={busy || protocol.phase === "disconnected"}>
          刷新
        </button>
      </header>

      <section className="task-composer" aria-labelledby="new-task-title">
        <div className="task-composer-heading">
          <div>
            <h2 id="new-task-title">交给 Harness</h2>
            <p>{activeProject ? `工作目录：${activeProject.path}` : "添加项目后才能创建任务。"}</p>
          </div>
          <span className={`connection-label connection-label--${protocol.phase}`} role="status">
            <span aria-hidden="true" />{PROTOCOL_LABEL[protocol.phase]}
          </span>
        </div>
        <textarea
          ref={composer}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.metaKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={activeProject ? "描述要完成的修改、约束和验收标准…" : "请先在“项目”中添加 Git 仓库"}
          disabled={!activeProject || busy}
          maxLength={20_000}
          aria-describedby="task-composer-help"
        />
        <div className="task-composer-footer">
          <span id="task-composer-help">⌘↵ 开始任务 · {prompt.length.toLocaleString("zh-CN")}/20,000</span>
          {activeProject ? (
            <button className="button button--primary" type="button" disabled={!canCreate || !prompt.trim()} onClick={() => void submit()}>
              开始任务
            </button>
          ) : (
            <button className="button button--primary" type="button" onClick={onChooseProject}>添加项目…</button>
          )}
        </div>
      </section>

      {(error || protocol.error) && (
        <section className="error-banner" role="alert">
          <strong>任务连接需要处理</strong>
          <p>{error ?? protocol.error}</p>
        </section>
      )}

      <section className="task-section" aria-labelledby="task-list-title">
        <div className="section-heading">
          <h2 id="task-list-title">最近任务</h2>
          <button className="archive-toggle" type="button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "查看进行中" : `已归档 ${protocol.tasks.filter((task) => (task.projectPath ?? task.cwd) === activeProject?.path && task.archived).length}`}</button>
        </div>
        {tasks.length === 0 ? (
          <div className="task-empty">
            <h2>{activeProject ? showArchived ? "没有已归档任务" : "这个项目还没有任务" : "选择一个项目查看任务"}</h2>
            <p>{activeProject ? showArchived ? "归档后的会话会保留在 Harness 中。" : "写下一个明确目标，任务启动后会在这里持续更新状态。" : "任务按仓库隔离，不会混入其他项目的会话。"}</p>
          </div>
        ) : (
          <div className="task-list">
            {tasks.map((task) => (
              <article className="task-row" key={task.sessionId}>
                <div className="task-state" aria-hidden="true">
                  <span className={task.running ? "task-state--running" : task.pendingApprovals ? "task-state--waiting" : undefined} />
                </div>
                <div className="task-copy">
                  <div className="task-title-line">
                    <h2>{task.title}</h2>
                    <span>{taskStatus(task)}</span>
                  </div>
                  <p>{new Date(task.updatedAt).toLocaleString("zh-CN")} · {task.sessionId.slice(0, 8)}</p>
                  {task.error && <p className="task-error">{task.error}</p>}
                </div>
                <div className="project-actions">
                  <button className="project-action" type="button" onClick={() => void openTask(task.sessionId)}>查看</button>
                  <button className="project-action" type="button" onClick={onOpenHarness}>Harness</button>
                  {task.running && (
                    <button className="project-action project-action--danger" type="button" onClick={() => onCancel(task.sessionId)} disabled={busy}>
                      停止
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="workspace-footer">
        <span>连接代次 {protocol.generation}</span>
        <span>断线后自动重建任务基线</span>
      </footer>
    </main>
  );
}

export function App() {
  const initialView = new URLSearchParams(window.location.search).get("view");
  const [view, setView] = useState<"runtime" | "projects" | "tasks" | "inbox" | "settings">(
    initialView === "projects" || initialView === "tasks" || initialView === "inbox" || initialView === "settings" ? initialView : "runtime",
  );
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [protocol, setProtocol] = useState(INITIAL_PROTOCOL);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [projectError, setProjectError] = useState<string>();
  const [taskError, setTaskError] = useState<string>();
  const [inboxError, setInboxError] = useState<string>();
  const [focusComposer, setFocusComposer] = useState(0);
  const [requestedTaskId, setRequestedTaskId] = useState<string>();

  useEffect(() => {
    void window.dshDesktop.getSidecarStatus().then(setSnapshot);
    return window.dshDesktop.subscribeSidecar(setSnapshot);
  }, []);

  useEffect(() => {
    if (!initialView) void window.dshDesktop.getSettings().then((value) => { if (!value.credentialConfigured) setView("settings"); });
  }, []);

  useEffect(() => {
    void window.dshDesktop.getProtocolStatus().then(setProtocol);
    const unsubscribeProtocol = window.dshDesktop.subscribeProtocol(setProtocol);
    const unsubscribeNewTask = window.dshDesktop.subscribeNewTask(() => {
      setView("tasks");
      setFocusComposer((value) => value + 1);
    });
    const unsubscribeInbox = window.dshDesktop.subscribeInboxFocus(() => setView("inbox"));
    return () => {
      unsubscribeProtocol();
      unsubscribeNewTask();
      unsubscribeInbox();
    };
  }, []);

  useEffect(() => {
    void refreshProjects();
    return window.dshDesktop.subscribeProjectPicker(() => {
      setView("projects");
      void chooseProject();
    });
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']") && event.key !== ",") return;
      const destination = ({ "1": "runtime", "2": "projects", "3": "tasks", "4": "inbox", ",": "settings" } as const)[event.key as "1" | "2" | "3" | "4" | ","];
      if (!destination) return;
      event.preventDefault();
      setView(destination);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  async function refreshProjects() {
    try {
      setProjects(await window.dshDesktop.listProjects());
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseProject() {
    setBusy(true);
    setProjectError(undefined);
    try {
      const result = await window.dshDesktop.chooseProject();
      if (!result.ok && !result.cancelled) setProjectError(result.error);
      await refreshProjects();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function activateProject(id: string) {
    setBusy(true);
    setProjectError(undefined);
    try {
      const result = await window.dshDesktop.activateProject(id);
      if (!result.ok) {
        setProjectError(result.error);
        return;
      }
      await refreshProjects();
      setView("runtime");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function revealProject(id: string) {
    try {
      const result = await window.dshDesktop.revealProject(id);
      if (!result.ok) setProjectError(result.error);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeProject(id: string) {
    setBusy(true);
    setProjectError(undefined);
    try {
      const result = await window.dshDesktop.removeProject(id);
      if (!result.ok) setProjectError(result.error);
      await refreshProjects();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createTask(prompt: string): Promise<boolean> {
    setBusy(true);
    setTaskError(undefined);
    try {
      const result = await window.dshDesktop.createTask(prompt);
      if (!result.ok) {
        setTaskError(result.error);
        return false;
      }
      return true;
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelTask(sessionId: string) {
    setBusy(true);
    setTaskError(undefined);
    try {
      const result = await window.dshDesktop.cancelTask(sessionId);
      if (!result.ok) setTaskError(result.error);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendTaskMessage(sessionId: string, prompt: string, mode: "queue" | "steer"): Promise<boolean> {
    setTaskError(undefined);
    const result = await window.dshDesktop.sendTaskMessage(sessionId, prompt, mode);
    if (!result.ok) { setTaskError(result.error); return false; }
    return true;
  }

  async function renameTask(sessionId: string, title: string): Promise<boolean> {
    setTaskError(undefined);
    const result = await window.dshDesktop.renameTask(sessionId, title);
    if (!result.ok) { setTaskError(result.error); return false; }
    return true;
  }

  async function forkTask(sessionId: string, atSeq?: number): Promise<string | undefined> {
    setTaskError(undefined);
    const result = await window.dshDesktop.forkTask(sessionId, atSeq);
    if (!result.ok) { setTaskError(result.error); return undefined; }
    return result.sessionId;
  }

  async function archiveTask(sessionId: string): Promise<boolean> {
    setTaskError(undefined);
    const result = await window.dshDesktop.archiveTask(sessionId);
    if (!result.ok) { setTaskError(result.error); return false; }
    return true;
  }

  async function respondApproval(approvalId: string, outcome: "allowed-once" | "rejected") {
    setInboxError(undefined);
    const result = await window.dshDesktop.respondApproval(approvalId, outcome);
    if (!result.ok) setInboxError(result.error);
  }

  async function respondQuestion(requestId: string, answers: Array<{ id: string; selected: string[]; custom?: string }>) {
    setInboxError(undefined);
    const result = await window.dshDesktop.respondQuestion(requestId, answers);
    if (!result.ok) setInboxError(result.error);
  }

  const uptime = useMemo(() => {
    if (!snapshot.startedAt) return "—";
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.startedAt)) / 1000));
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分钟`;
  }, [snapshot.startedAt, snapshot.phase]);

  async function run(action: () => Promise<SidecarSnapshot>) {
    setBusy(true);
    setActionError(undefined);
    try {
      setSnapshot(await action());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openHarness() {
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await window.dshDesktop.openHarness();
      if (!result.ok) setActionError(result.error);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const isReady = snapshot.phase === "ready" && snapshot.adapter.phase === "ready";
  const isTransitioning = snapshot.phase === "starting" || snapshot.phase === "stopping";
  const inboxCount = protocol.approvals.length + protocol.questions.length + protocol.tasks.filter((task) => task.readyForReview && task.worktreeBranch && !task.archived && !task.error).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-light-space" aria-hidden="true" />
        <div className="product-mark">
          <span className="product-glyph">D</span>
          <div>
            <strong>DSH Desktop</strong>
            <span>社区预览版</span>
          </div>
        </div>

        <nav aria-label="主导航">
          <button className={`nav-item${view === "runtime" ? " nav-item--active" : ""}`} type="button" onClick={() => setView("runtime")}>
            <span className="nav-icon">⌁</span>
            运行时
          </button>
          <button className={`nav-item${view === "projects" ? " nav-item--active" : ""}`} type="button" onClick={() => setView("projects")}>
            <span className="nav-icon">⌘</span>
            项目
            {projects.length > 0 && <span className="nav-badge">{projects.length}</span>}
          </button>
          <button className={`nav-item${view === "tasks" ? " nav-item--active" : ""}`} type="button" onClick={() => setView("tasks")}>
            <span className="nav-icon">◉</span>
            任务
            {protocol.tasks.filter((task) => task.running).length > 0 && (
              <span className="nav-badge">{protocol.tasks.filter((task) => task.running).length}</span>
            )}
          </button>
          <button className={`nav-item${view === "inbox" ? " nav-item--active" : ""}`} type="button" onClick={() => setView("inbox")}>
            <span className="nav-icon">◫</span>
            待处理
            {inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
          </button>
          <button className={`nav-item${view === "settings" ? " nav-item--active" : ""}`} type="button" onClick={() => setView("settings")}>
            <span className="nav-icon">⚙</span>
            设置
          </button>
        </nav>

        <div className="sidebar-footer">
          <span>本地优先 · 安全隔离</span>
          <span>macOS · Apple Silicon</span>
        </div>
      </aside>

      {view === "settings" ? (
        <SettingsView runtime={snapshot} protocol={protocol} />
      ) : view === "inbox" ? (
        <InboxView protocol={protocol} error={inboxError} onApproval={(id, outcome) => void respondApproval(id, outcome)} onQuestion={(id, answers) => void respondQuestion(id, answers)} onOpenTask={(id) => { setRequestedTaskId(id); setView("tasks"); }} />
      ) : view === "projects" ? (
        <ProjectsView
          projects={projects}
          busy={busy}
          error={projectError}
          onChoose={() => void chooseProject()}
          onActivate={(id) => void activateProject(id)}
          onReveal={(id) => void revealProject(id)}
          onRemove={(id) => void removeProject(id)}
        />
      ) : view === "tasks" ? (
        <TasksView
          protocol={protocol}
          activeProject={projects.find((project) => project.active)}
          busy={busy}
          error={taskError}
          focusComposer={focusComposer}
          onCreate={createTask}
          onSend={sendTaskMessage}
          onRename={renameTask}
          onFork={forkTask}
          onArchive={archiveTask}
          onCancel={(sessionId) => void cancelTask(sessionId)}
          onRefresh={() => void window.dshDesktop.refreshTasks().catch((error: unknown) => setTaskError(error instanceof Error ? error.message : String(error)))}
          onChooseProject={() => setView("projects")}
          onOpenHarness={() => void openHarness()}
          openSessionId={requestedTaskId}
          onOpenedSession={() => setRequestedTaskId(undefined)}
        />
      ) : <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="context-line">本机运行环境</p>
            <h1>DeepSeek Harness</h1>
          </div>
          <div className={`status-chip status-chip--${snapshot.phase}`} role="status" aria-live="polite">
            <StatusMark phase={snapshot.phase} />
            {PHASE_LABEL[snapshot.phase]}
          </div>
        </header>

        <section className="runtime-hero" aria-labelledby="runtime-title">
          <div className="runtime-copy">
            <div className="runtime-title-row">
              <StatusMark phase={snapshot.phase} />
              <h2 id="runtime-title">{PHASE_LABEL[snapshot.phase]}</h2>
            </div>
            <p>
              Harness 在独立进程中运行，桌面端通过带临时凭证的本机适配层访问工作区；
              Renderer 不接触凭证，也不能直连上游端口。
            </p>
          </div>

          <div className="actions">
            {isReady ? (
              <button className="button button--primary" type="button" onClick={openHarness} disabled={busy}>
                打开 Harness
              </button>
            ) : (
              <button
                className="button button--primary"
                type="button"
                onClick={() => run(() => window.dshDesktop.startSidecar())}
                disabled={busy || isTransitioning}
              >
                启动 Harness
              </button>
            )}
            <button
              className="button button--secondary"
              type="button"
              onClick={() => run(() => window.dshDesktop.restartSidecar())}
              disabled={busy || isTransitioning}
            >
              重新启动
            </button>
          </div>
        </section>

        {(snapshot.error || actionError) && (
          <section className="error-banner" role="alert">
            <strong>运行时需要处理</strong>
            <p>{actionError ?? snapshot.error}</p>
          </section>
        )}

        <section className="runtime-grid" aria-label="运行时详情">
          <div className="detail-panel">
            <div className="section-heading">
              <h2>进程</h2>
              <span>独立 Sidecar</span>
            </div>
            <dl>
              <RuntimeDetail label="Harness 版本" value={snapshot.harnessVersion} />
              <RuntimeDetail label="进程 ID" value={snapshot.pid?.toString() ?? "—"} />
              <RuntimeDetail label="运行时间" value={uptime} />
              <RuntimeDetail label="受保护端点" value={snapshot.url ?? "等待适配层"} />
            </dl>
          </div>

          <div className="detail-panel detail-panel--security">
            <div className="section-heading">
              <h2>边界</h2>
              <span>协议 v{snapshot.adapter.protocolVersion}</span>
            </div>
            <ul className="check-list">
              <li><span>✓</span>Renderer 无 Node 与文件系统权限</li>
              <li><span>✓</span>仅监听 127.0.0.1 随机端口</li>
              <li><span>✓</span>Harness 数据存入应用专属目录</li>
              <li className={snapshot.adapter.authenticated ? undefined : "check-list__warning"}>
                <span>{snapshot.adapter.authenticated ? "✓" : "!"}</span>
                {snapshot.adapter.authenticated ? "桌面适配层已完成临时凭证握手" : "桌面适配层尚未完成认证握手"}
              </li>
            </ul>
          </div>
        </section>

        <section className="log-panel">
          <div className="section-heading">
            <h2>最近活动</h2>
            <span>{snapshot.logs.length} 条</span>
          </div>
          <div className="log-output" tabIndex={0} aria-label="Harness 最近日志">
            {snapshot.logs.length === 0 ? (
              <p className="log-empty">启动后将在这里显示经过脱敏的运行时事件。</p>
            ) : (
              snapshot.logs.slice(-8).map((line, index) => <code key={`${index}-${line}`}>{line}</code>)
            )}
          </div>
        </section>

        <footer className="workspace-footer">
          <span>非 DeepSeek 官方应用</span>
          <button
            className="text-button"
            type="button"
            onClick={() => run(() => window.dshDesktop.stopSidecar())}
            disabled={busy || snapshot.phase === "stopped" || snapshot.phase === "idle"}
          >
            停止运行时
          </button>
        </footer>
      </main>}
    </div>
  );
}
