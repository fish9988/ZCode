import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export interface ReconcileForeignPiTasksResult {
  prunedTaskCount: number;
  prunedProjectCount: number;
}

interface IndexedTaskCandidate {
  workspace_key: string;
  workspace_path: string;
  task_id: string;
  project_id: string | null;
  model: string | null;
  cli_created_at: number | null;
}

function normalizeComparablePath(pathValue: string): string {
  const trimmed = pathValue.trim().replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function resolveDefaultCliDbPath(tasksDbPath: string): string {
  return join(dirname(dirname(tasksDbPath)), "cli", "db", "db.sqlite");
}

function readCliSessionFacts(cliDbPath: string): {
  sessionIds: Set<string>;
  sessionDirs: Set<string>;
} | null {
  if (!existsSync(cliDbPath)) {
    return null;
  }

  let cliDb: InstanceType<typeof DatabaseSync> | null = null;
  try {
    cliDb = new DatabaseSync(cliDbPath, { readOnly: true });
    const hasSessionTable = cliDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session' LIMIT 1")
      .get();
    if (!hasSessionTable) {
      return null;
    }

    const sessionIds = new Set<string>();
    const sessionDirs = new Set<string>();
    const rows = cliDb.prepare("SELECT id, directory FROM session").all() as Array<{
      id: unknown;
      directory: unknown;
    }>;
    for (const row of rows) {
      if (typeof row.id === "string" && row.id.length > 0) {
        sessionIds.add(row.id);
      }
      if (typeof row.directory === "string" && row.directory.trim().length > 0) {
        sessionDirs.add(normalizeComparablePath(row.directory));
      }
    }
    return { sessionIds, sessionDirs };
  } catch {
    return null;
  } finally {
    try {
      cliDb?.close();
    } catch {
      /* ignore close errors on read-only inspection */
    }
  }
}

function isForeignPiTaskCandidate(
  row: IndexedTaskCandidate,
  cliSessionIds: ReadonlySet<string>,
): boolean {
  if (cliSessionIds.has(row.task_id)) {
    return false;
  }
  if (!row.task_id.startsWith("sess_")) {
    return true;
  }
  if (typeof row.model === "string" && row.model.includes("$")) {
    return true;
  }
  if (row.cli_created_at !== null) {
    return true;
  }
  return false;
}

export function reconcileForeignPiTasksFromTasksIndex(
  tasksDbPath: string,
  options?: { cliDbPath?: string; nowMs?: number },
): ReconcileForeignPiTasksResult {
  const cliDbPath = options?.cliDbPath ?? resolveDefaultCliDbPath(tasksDbPath);
  const cliFacts = readCliSessionFacts(cliDbPath);
  if (!cliFacts) {
    return { prunedTaskCount: 0, prunedProjectCount: 0 };
  }

  let tasksDb: InstanceType<typeof DatabaseSync> | null = null;
  try {
    tasksDb = new DatabaseSync(tasksDbPath);
    tasksDb.exec("PRAGMA busy_timeout = 5000");
    tasksDb.exec("PRAGMA foreign_keys = ON");

    const hasTasksTable = tasksDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks' LIMIT 1")
      .get();
    if (!hasTasksTable) {
      return { prunedTaskCount: 0, prunedProjectCount: 0 };
    }

    const candidates = tasksDb
      .prepare(
        `SELECT workspace_key, workspace_path, task_id, project_id, model, cli_created_at
         FROM tasks
         WHERE coalesce(host_id, 'local') = 'local'
           AND workspace_identity IS NULL`,
      )
      .all() as unknown as IndexedTaskCandidate[];

    const toPrune = candidates.filter((row) => isForeignPiTaskCandidate(row, cliFacts.sessionIds));
    if (toPrune.length === 0) {
      return { prunedTaskCount: 0, prunedProjectCount: 0 };
    }

    const affectedProjectIds = new Set<string>();
    const hasTable = (tableName: string): boolean =>
      Boolean(
        tasksDb!
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
          .get(tableName),
      );

    const hasGroupMembers = hasTable("task_group_members");
    const hasGroupAdmissions = hasTable("task_group_admissions");
    const hasViewNodeOrders = hasTable("task_group_view_node_orders");
    const hasCreationCommands = hasTable("session_creation_commands");
    const hasProjects = hasTable("projects") && hasTable("project_roots");

    const deleteTaskStmt = tasksDb.prepare(
      "DELETE FROM tasks WHERE workspace_key = ? AND task_id = ?",
    );
    const deleteGroupMemberStmt = hasGroupMembers
      ? tasksDb.prepare("DELETE FROM task_group_members WHERE workspace_key = ? AND task_id = ?")
      : null;
    const deleteGroupAdmissionStmt = hasGroupAdmissions
      ? tasksDb.prepare("DELETE FROM task_group_admissions WHERE workspace_key = ? AND task_id = ?")
      : null;
    const deleteViewNodeOrderStmt = hasViewNodeOrders
      ? tasksDb.prepare(
          "DELETE FROM task_group_view_node_orders WHERE node_type = 'task' AND node_key = ?",
        )
      : null;
    const deleteCreationCommandStmt = hasCreationCommands
      ? tasksDb.prepare(
          "DELETE FROM session_creation_commands WHERE workspace_key = ? AND session_id = ?",
        )
      : null;

    let prunedProjectCount = 0;
    const now = options?.nowMs ?? Date.now();

    tasksDb.exec("BEGIN IMMEDIATE");
    try {
      for (const row of toPrune) {
        deleteTaskStmt.run(row.workspace_key, row.task_id);
        deleteGroupMemberStmt?.run(row.workspace_key, row.task_id);
        deleteGroupAdmissionStmt?.run(row.workspace_key, row.task_id);
        deleteViewNodeOrderStmt?.run(JSON.stringify([row.workspace_key, row.task_id]));
        deleteCreationCommandStmt?.run(row.workspace_key, row.task_id);
        if (row.project_id) {
          affectedProjectIds.add(row.project_id);
        }
      }

      if (hasProjects && affectedProjectIds.size > 0) {
        const selectProjectRootsStmt = tasksDb.prepare(
          "SELECT root_path FROM project_roots WHERE project_id = ?",
        );
        const hasRemainingMaterializedTasksStmt = tasksDb.prepare(
          `SELECT 1 FROM tasks
           WHERE project_id = ?
             AND deleted = 0
             AND coalesce(cli_deleted, 0) = 0
             AND cli_created_at IS NOT NULL
           LIMIT 1`,
        );
        const selectProjectPlaceholdersStmt = tasksDb.prepare(
          `SELECT workspace_key, task_id FROM tasks
           WHERE project_id = ?
             AND cli_created_at IS NULL`,
        );
        const softDeleteProjectStmt = tasksDb.prepare(
          `UPDATE projects
           SET deleted = 1, deleted_at = coalesce(deleted_at, ?), updated_at = ?
           WHERE project_id = ? AND host_id = 'local' AND deleted = 0`,
        );

        for (const projectId of affectedProjectIds) {
          const remaining = hasRemainingMaterializedTasksStmt.get(projectId);
          if (remaining) {
            continue;
          }

          const rootRows = selectProjectRootsStmt.all(projectId) as Array<{
            root_path: unknown;
          }>;
          const hasCliDirectory = rootRows.some(
            (rootRow) =>
              typeof rootRow.root_path === "string" &&
              cliFacts.sessionDirs.has(normalizeComparablePath(rootRow.root_path)),
          );
          if (hasCliDirectory) {
            continue;
          }

          const placeholders = selectProjectPlaceholdersStmt.all(projectId) as Array<{
            workspace_key: string;
            task_id: string;
          }>;
          for (const placeholder of placeholders) {
            if (cliFacts.sessionIds.has(placeholder.task_id)) continue;
            deleteTaskStmt.run(placeholder.workspace_key, placeholder.task_id);
            deleteGroupMemberStmt?.run(placeholder.workspace_key, placeholder.task_id);
            deleteGroupAdmissionStmt?.run(placeholder.workspace_key, placeholder.task_id);
            deleteViewNodeOrderStmt?.run(
              JSON.stringify([placeholder.workspace_key, placeholder.task_id]),
            );
            deleteCreationCommandStmt?.run(placeholder.workspace_key, placeholder.task_id);
          }

          const updateResult = softDeleteProjectStmt.run(now, now, projectId);
          if (updateResult.changes > 0) {
            prunedProjectCount += 1;
          }
        }
      }

      tasksDb.exec("COMMIT");
    } catch (error) {
      try {
        tasksDb.exec("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      throw error;
    }

    return {
      prunedTaskCount: toPrune.length,
      prunedProjectCount,
    };
  } finally {
    try {
      tasksDb?.close();
    } catch {
      /* ignore close errors */
    }
  }
}
