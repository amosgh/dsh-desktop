import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ProjectRecord, TaskWorkspaceRecord } from "../shared/contracts.js";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
}

interface TaskWorkspaceRow {
  session_id: string;
  project_id: string;
  repository_path: string;
  worktree_path: string;
  branch: string;
  base_sha: string;
  created_at: string;
  state: TaskWorkspaceRecord["state"];
}

export class ProjectStore {
  #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  list(): ProjectRecord[] {
    const activeId = this.#getSetting("active_project_id");
    const rows = this.#database.prepare(`
      SELECT id, name, path, added_at, last_opened_at
      FROM projects
      ORDER BY last_opened_at DESC, name COLLATE NOCASE ASC
    `).all() as unknown as ProjectRow[];
    return rows.map((row) => this.#toRecord(row, activeId));
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.#database.prepare(`
      SELECT id, name, path, added_at, last_opened_at FROM projects WHERE id = ?
    `).get(id) as unknown as ProjectRow | undefined;
    return row ? this.#toRecord(row, this.#getSetting("active_project_id")) : undefined;
  }

  addOrTouch(name: string, path: string): ProjectRecord {
    const now = new Date().toISOString();
    const existing = this.#database.prepare("SELECT id FROM projects WHERE path = ?").get(path) as
      | { id: string }
      | undefined;
    const id = existing?.id ?? randomUUID();
    this.#database.prepare(`
      INSERT INTO projects (id, name, path, added_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at
    `).run(id, name, path, now, now);
    const record = this.get(id);
    if (!record) throw new Error("Project was not persisted.");
    return record;
  }

  activate(id: string): ProjectRecord | undefined {
    const project = this.get(id);
    if (!project) return undefined;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare("UPDATE projects SET last_opened_at = ? WHERE id = ?").run(now, id);
      this.#setSetting("active_project_id", id);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.get(id);
  }

  remove(id: string): boolean {
    const result = this.#database.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (this.#getSetting("active_project_id") === id) this.#setSetting("active_project_id", "");
    return result.changes > 0;
  }

  saveTaskWorkspace(record: TaskWorkspaceRecord): void {
    this.#database.prepare(`
      INSERT INTO task_workspaces (session_id, project_id, repository_path, worktree_path, branch, base_sha, created_at, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        project_id = excluded.project_id,
        repository_path = excluded.repository_path,
        worktree_path = excluded.worktree_path,
        branch = excluded.branch,
        base_sha = excluded.base_sha,
        state = excluded.state
    `).run(record.sessionId, record.projectId, record.repositoryPath, record.worktreePath, record.branch, record.baseSha, record.createdAt, record.state);
  }

  getTaskWorkspace(sessionId: string): TaskWorkspaceRecord | undefined {
    const row = this.#database.prepare("SELECT * FROM task_workspaces WHERE session_id = ?").get(sessionId) as unknown as TaskWorkspaceRow | undefined;
    return row ? this.#toTaskWorkspace(row) : undefined;
  }

  listTaskWorkspaces(projectId?: string): TaskWorkspaceRecord[] {
    const rows = (projectId
      ? this.#database.prepare("SELECT * FROM task_workspaces WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
      : this.#database.prepare("SELECT * FROM task_workspaces ORDER BY created_at DESC").all()) as unknown as TaskWorkspaceRow[];
    return rows.map((row) => this.#toTaskWorkspace(row));
  }

  updateTaskWorkspaceState(sessionId: string, state: TaskWorkspaceRecord["state"]): void {
    this.#database.prepare("UPDATE task_workspaces SET state = ? WHERE session_id = ?").run(state, sessionId);
  }

  getPreference(key: string): string | undefined {
    return this.#getSetting(key);
  }

  setPreference(key: string, value: string): void {
    this.#setSetting(key, value);
  }

  #migrate(): void {
    const version = this.#database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version < 1) this.#database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
    if (version.user_version < 2) this.#database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE task_workspaces (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        repository_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'committed', 'discarded', 'missing'))
      );
      CREATE INDEX task_workspaces_project_idx ON task_workspaces(project_id, created_at DESC);
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }

  #getSetting(key: string): string | undefined {
    const row = this.#database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value || undefined;
  }

  #setSetting(key: string, value: string): void {
    this.#database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  #toRecord(row: ProjectRow, activeId: string | undefined): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      addedAt: row.added_at,
      lastOpenedAt: row.last_opened_at,
      active: row.id === activeId,
    };
  }

  #toTaskWorkspace(row: TaskWorkspaceRow): TaskWorkspaceRecord {
    return {
      sessionId: row.session_id,
      projectId: row.project_id,
      repositoryPath: row.repository_path,
      worktreePath: row.worktree_path,
      branch: row.branch,
      baseSha: row.base_sha,
      createdAt: row.created_at,
      state: row.state,
    };
  }
}
