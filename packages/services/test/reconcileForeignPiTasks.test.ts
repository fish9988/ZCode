import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { reconcileForeignPiTasksFromTasksIndex } from "../src/project-storage/reconcile-foreign-pi-tasks.js";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const tempDirs: string[] = [];

function createTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-reconcile-pi-"));
  tempDirs.push(dir);
  return dir;
}

function createCliDb(cliDbPath: string, sessions: Array<{ id: string; directory: string }>): void {
  mkdirSync(join(cliDbPath, ".."), { recursive: true });
  const db = new DatabaseSync(cliDbPath);
  try {
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL)");
    const stmt = db.prepare("INSERT INTO session (id, directory) VALUES (?, ?)");
    for (const session of sessions) {
      stmt.run(session.id, session.directory);
    }
  } finally {
    db.close();
  }
}

function createTasksIndexDb(tasksDbPath: string): InstanceType<typeof DatabaseSync> {
  mkdirSync(join(tasksDbPath, ".."), { recursive: true });
  const db = new DatabaseSync(tasksDbPath);
  db.exec(`
    CREATE TABLE projects (
      project_id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE project_roots (
      project_id TEXT NOT NULL,
      root_path TEXT NOT NULL
    );
    CREATE TABLE tasks (
      workspace_key TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      workspace_identity TEXT,
      task_id TEXT NOT NULL,
      host_id TEXT DEFAULT 'local',
      project_id TEXT,
      model TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      cli_deleted INTEGER DEFAULT 0,
      cli_created_at INTEGER,
      PRIMARY KEY (workspace_key, task_id)
    );
    CREATE TABLE task_group_admissions (
      workspace_key TEXT NOT NULL,
      task_id TEXT NOT NULL
    );
    CREATE TABLE task_group_view_node_orders (
      node_type TEXT NOT NULL,
      node_key TEXT NOT NULL
    );
    CREATE TABLE session_creation_commands (
      workspace_key TEXT NOT NULL,
      client_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      session_id TEXT NOT NULL
    );
  `);
  return db;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("reconcileForeignPiTasksFromTasksIndex", () => {
  it("no-ops safely when sibling zcode-cli db.sqlite does not exist", () => {
    const root = createTempRoot();
    const tasksDbPath = join(root, "v2", "tasks-index.sqlite");
    const db = createTasksIndexDb(tasksDbPath);
    db.prepare(
      "INSERT INTO tasks (workspace_key, workspace_path, task_id, model, cli_created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("C:\\pi-project\\chat", "C:\\pi-project\\chat", "01a19abc", null, 1000);
    db.close();

    const result = reconcileForeignPiTasksFromTasksIndex(tasksDbPath);
    expect(result).toEqual({ prunedTaskCount: 0, prunedProjectCount: 0 });
  });

  it("prunes Pi native ULID tasks, Pi Zero sess_* tasks, and empty Pi projects while keeping ZCode sessions, drafts, and remote tasks", () => {
    const root = createTempRoot();
    const tasksDbPath = join(root, "v2", "tasks-index.sqlite");
    const cliDbPath = join(root, "cli", "db", "db.sqlite");

    createCliDb(cliDbPath, [
      { id: "sess_zcode_valid", directory: "D:\\zcode\\normal" },
    ]);

    const db = createTasksIndexDb(tasksDbPath);
    db.prepare("INSERT INTO projects (project_id, host_id, name, deleted) VALUES (?, 'local', ?, 0)").run(
      "proj_zcode",
      "normal",
    );
    db.prepare("INSERT INTO project_roots (project_id, root_path) VALUES (?, ?)").run(
      "proj_zcode",
      "D:\\zcode\\normal",
    );
    db.prepare("INSERT INTO projects (project_id, host_id, name, deleted) VALUES (?, 'local', ?, 0)").run(
      "proj_pi",
      "chats",
    );
    db.prepare("INSERT INTO project_roots (project_id, root_path) VALUES (?, ?)").run(
      "proj_pi",
      "C:\\Users\\lai\\pi-studio\\chats",
    );
    db.prepare("INSERT INTO projects (project_id, host_id, name, deleted) VALUES (?, 'local', ?, 0)").run(
      "proj_empty_user",
      "fresh-project",
    );
    db.prepare("INSERT INTO project_roots (project_id, root_path) VALUES (?, ?)").run(
      "proj_empty_user",
      "D:\\zcode\\fresh",
    );

    const insertTask = db.prepare(
      `INSERT INTO tasks (workspace_key, workspace_path, workspace_identity, task_id, host_id, project_id, model, cli_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertTask.run("D:\\zcode\\normal", "D:\\zcode\\normal", null, "sess_zcode_valid", "local", "proj_zcode", "account:bigmodel/GLM-5", 100);
    insertTask.run("D:\\zcode\\normal", "D:\\zcode\\normal", null, "sess_zcode_draft", "local", "proj_zcode", null, null);
    insertTask.run("ssh://box/work", "/work", "ssh://box/work", "01remote", "remote-1", null, null, 200);
    insertTask.run("C:\\Users\\lai\\pi-studio\\chats", "C:\\Users\\lai\\pi-studio\\chats", null, "01a19ff001", "local", "proj_pi", null, 300);
    insertTask.run("C:\\Users\\lai\\pi-studio\\chats", "C:\\Users\\lai\\pi-studio\\chats", null, "sess_pi_zero_1", "local", "proj_pi", "magpie/auto/gpt-6.2-sol$high", 400);
    insertTask.run("D:\\zcode\\normal", "D:\\zcode\\normal", null, "sess_pi_in_zcode", "local", "proj_zcode", "antigravity/gemini-4$high", 500);

    db.prepare("INSERT INTO task_group_admissions (workspace_key, task_id) VALUES (?, ?)").run(
      "C:\\Users\\lai\\pi-studio\\chats",
      "sess_pi_zero_1",
    );
    db.prepare("INSERT INTO task_group_view_node_orders (node_type, node_key) VALUES ('task', ?)").run(
      JSON.stringify(["C:\\Users\\lai\\pi-studio\\chats", "sess_pi_zero_1"]),
    );
    db.close();

    const result = reconcileForeignPiTasksFromTasksIndex(tasksDbPath, { nowMs: 9999 });
    expect(result).toEqual({ prunedTaskCount: 3, prunedProjectCount: 1 });

    const verifyDb = new DatabaseSync(tasksDbPath, { readOnly: true });
    try {
      const remainingIds = (
        verifyDb.prepare("SELECT task_id FROM tasks ORDER BY task_id").all() as Array<{
          task_id: string;
        }>
      ).map((r) => r.task_id);
      expect(remainingIds).toEqual(["01remote", "sess_zcode_draft", "sess_zcode_valid"]);

      const projects = verifyDb
        .prepare("SELECT project_id, deleted FROM projects ORDER BY project_id")
        .all() as Array<{ project_id: string; deleted: number }>;
      expect(projects).toEqual([
        { project_id: "proj_empty_user", deleted: 0 },
        { project_id: "proj_pi", deleted: 1 },
        { project_id: "proj_zcode", deleted: 0 },
      ]);

      expect(verifyDb.prepare("SELECT count(*) AS cnt FROM task_group_admissions").get()).toEqual({
        cnt: 0,
      });
      expect(
        verifyDb.prepare("SELECT count(*) AS cnt FROM task_group_view_node_orders").get(),
      ).toEqual({ cnt: 0 });
    } finally {
      verifyDb.close();
    }
  });
});
