export type SidecarPhase =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "error";

export interface SidecarSnapshot {
  phase: SidecarPhase;
  harnessVersion: string;
  url?: string | undefined;
  pid?: number | undefined;
  startedAt?: string | undefined;
  error?: string | undefined;
  logs: string[];
  adapter: AdapterSnapshot;
  restartAttempt?: number | undefined;
}

export type AdapterPhase = "locked" | "starting" | "ready" | "error";

export interface AdapterSnapshot {
  phase: AdapterPhase;
  protocolVersion: "1";
  authenticated: boolean;
  endpoint?: string | undefined;
  error?: string | undefined;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  active: boolean;
}

export interface TaskWorkspaceRecord {
  sessionId: string;
  projectId: string;
  repositoryPath: string;
  worktreePath: string;
  branch: string;
  baseSha: string;
  createdAt: string;
  state: "active" | "committed" | "discarded" | "missing";
}

export interface GitChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
  oldPath?: string | undefined;
}

export interface GitReviewSnapshot {
  sessionId: string;
  workspace?: TaskWorkspaceRecord | undefined;
  phase: "ready" | "unavailable" | "error";
  files: GitChangedFile[];
  additions: number;
  deletions: number;
  clean: boolean;
  error?: string | undefined;
}

export interface SettingsSnapshot {
  credentialConfigured: boolean;
  baseURL: string;
  model: string;
  editor: "vscode" | "system";
  telemetry: false;
}

export type ProtocolPhase = "disconnected" | "connecting" | "connected" | "recovering" | "error";

export interface DesktopTaskSummary {
  sessionId: string;
  title: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string | undefined;
  projectPath?: string | undefined;
  worktreeBranch?: string | undefined;
  workspaceState?: TaskWorkspaceRecord["state"] | undefined;
  lastSeq?: number | undefined;
  pendingApprovals: number;
  archived: boolean;
  readyForReview: boolean;
  error?: string | undefined;
}

export interface FilePreview {
  path: string;
  kind: "markdown";
  content: string;
}

export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  toolName: string;
  callId?: string | undefined;
  reason?: string | undefined;
  detail?: string | undefined;
  requestedAt: number;
  state: "pending" | "resolving";
}

export interface QuestionOption {
  label: string;
  description?: string | undefined;
}

export interface PendingQuestionItem {
  id: string;
  question: string;
  detail?: string | undefined;
  header?: string | undefined;
  options: QuestionOption[];
  multiSelect: boolean;
  intent?: { kind: "plan-review"; approve: string } | undefined;
}

export interface PendingQuestion {
  requestId: string;
  sessionId: string;
  questions: PendingQuestionItem[];
  requestedAt: number;
  state: "pending" | "resolving";
}

export interface ProtocolSnapshot {
  phase: ProtocolPhase;
  generation: number;
  tasks: DesktopTaskSummary[];
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  connectedAt?: string | undefined;
  error?: string | undefined;
}

export type TimelineItemKind = "user" | "assistant" | "reasoning" | "tool" | "status" | "context";

export interface TimelineItem {
  id: string;
  seq: number;
  time: number;
  kind: TimelineItemKind;
  text?: string | undefined;
  title?: string | undefined;
  detail?: string | undefined;
  toolName?: string | undefined;
  toolState?: "running" | "completed" | "error" | undefined;
  partial?: boolean | undefined;
}

export interface TaskTimelineSnapshot {
  sessionId: string;
  phase: "idle" | "loading" | "ready" | "error";
  items: TimelineItem[];
  hasMore: boolean;
  plan?: Array<{ content: string; status: "pending" | "in_progress" | "completed" }> | undefined;
  beforeSeq?: number | undefined;
  error?: string | undefined;
}

export type ChooseProjectResult =
  | { ok: true; project: ProjectRecord }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string };

export interface DesktopApi {
  getSidecarStatus(): Promise<SidecarSnapshot>;
  startSidecar(): Promise<SidecarSnapshot>;
  stopSidecar(): Promise<SidecarSnapshot>;
  restartSidecar(): Promise<SidecarSnapshot>;
  openHarness(): Promise<{ ok: true } | { ok: false; error: string }>;
  subscribeSidecar(listener: (snapshot: SidecarSnapshot) => void): () => void;
  listProjects(): Promise<ProjectRecord[]>;
  chooseProject(): Promise<ChooseProjectResult>;
  activateProject(id: string): Promise<{ ok: true; project: ProjectRecord } | { ok: false; error: string }>;
  removeProject(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  revealProject(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  subscribeProjectPicker(listener: () => void): () => void;
  getProtocolStatus(): Promise<ProtocolSnapshot>;
  refreshTasks(): Promise<ProtocolSnapshot>;
  createTask(prompt: string): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>;
  cancelTask(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  sendTaskMessage(sessionId: string, prompt: string, mode: "queue" | "steer"): Promise<{ ok: true } | { ok: false; error: string }>;
  renameTask(sessionId: string, title: string): Promise<{ ok: true; title: string } | { ok: false; error: string }>;
  forkTask(sessionId: string, atSeq?: number): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>;
  archiveTask(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  getTaskReview(sessionId: string): Promise<GitReviewSnapshot>;
  getTaskFileDiff(sessionId: string, path: string): Promise<{ ok: true; diff: string } | { ok: false; error: string }>;
  getTaskFilePreview(sessionId: string, path: string): Promise<{ ok: true; preview: FilePreview } | { ok: false; error: string }>;
  commitTask(sessionId: string, message: string): Promise<{ ok: true; sha: string } | { ok: false; error: string }>;
  discardTaskWorkspace(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  openTaskWorkspace(sessionId: string, target: "finder" | "terminal" | "editor"): Promise<{ ok: true } | { ok: false; error: string }>;
  openWebAddress(url: string): Promise<{ ok: true } | { ok: false; error: string }>;
  getSettings(): Promise<SettingsSnapshot>;
  saveSettings(input: { apiKey?: string; clearApiKey?: boolean; baseURL: string; model: string; editor: "vscode" | "system" }): Promise<{ ok: true; settings: SettingsSnapshot } | { ok: false; error: string }>;
  testModelConnection(input: { apiKey?: string; baseURL: string }): Promise<{ ok: true; models: string[] } | { ok: false; error: string }>;
  exportDiagnostics(): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }>;
  respondApproval(approvalId: string, outcome: "allowed-once" | "rejected"): Promise<{ ok: true } | { ok: false; error: string }>;
  respondQuestion(requestId: string, answers: Array<{ id: string; selected: string[]; custom?: string }>): Promise<{ ok: true } | { ok: false; error: string }>;
  getTaskTimeline(sessionId: string): Promise<TaskTimelineSnapshot>;
  loadOlderTaskTimeline(sessionId: string): Promise<TaskTimelineSnapshot>;
  subscribeTaskTimeline(listener: (snapshot: TaskTimelineSnapshot) => void): () => void;
  subscribeProtocol(listener: (snapshot: ProtocolSnapshot) => void): () => void;
  subscribeNewTask(listener: () => void): () => void;
  subscribeInboxFocus(listener: () => void): () => void;
  subscribeSettingsOpen(listener: () => void): () => void;
}
