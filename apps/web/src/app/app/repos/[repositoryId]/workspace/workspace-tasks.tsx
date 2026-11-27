"use client";

import type { CreateTeamTaskInput, TeamTask, TeamTaskConflict, TeamTaskList, TeamTaskStatus } from "@nutshell/server/team-tasks";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export const taskStatusLabels: Record<TeamTaskStatus, string> = {
  todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done",
};

export type TaskFields = {
  title: string;
  description: string;
  assigneeId: string;
  deadline: string;
  status: TeamTaskStatus;
  blocker: string;
  entityIds: string[];
  issueNumbers: string;
  pullRequestNumbers: string;
};

type TaskEditor = { task: TeamTask | null; baseline: TaskFields; fields: TaskFields; conflict: TeamTaskConflict | null };
type DeleteConfirmation = { id: string; version: number };
type ListResult = TeamTaskList & { status: "ready" };
type TaskClient = {
  data: ListResult | null;
  loading: boolean;
  error: string;
  status: string;
  pending: boolean;
  selected: TeamTask | null;
  editor: TaskEditor | null;
  deleteConfirmation: DeleteConfirmation | null;
  load: () => Promise<void>;
  select: (id: string) => void;
  edit: (task?: TeamTask) => void;
  change: (patch: Partial<TaskFields>) => void;
  cancel: () => void;
  resolveConflict: (keep: boolean) => void;
  save: () => Promise<void>;
  confirmDelete: (task: TeamTask) => void;
  cancelDelete: () => void;
  remove: () => Promise<void>;
};

const TaskContext = createContext<TaskClient | null>(null);

export function useWorkspaceTasks() {
  const value = useContext(TaskContext);
  if (!value) throw new Error("Team tasks require the workspace task state.");
  return value;
}

function fieldsFor(viewerId: string, task?: TeamTask): TaskFields {
  return {
    title: task?.title ?? "", description: task?.description ?? "", assigneeId: task?.assigneeId ?? viewerId,
    deadline: task?.deadline ?? "", status: task?.status ?? "todo", blocker: task?.blocker ?? "",
    entityIds: task?.entityIds ?? [], issueNumbers: task?.issueNumbers.join(", ") ?? "",
    pullRequestNumbers: task?.pullRequestNumbers.join(", ") ?? "",
  };
}

function changesBetween<T extends object>(baseline: T, next: T): Partial<T> {
  return Object.fromEntries((Object.keys(next) as (keyof T)[])
    .filter((key) => JSON.stringify(baseline[key]) !== JSON.stringify(next[key]))
    .map((key) => [key, next[key]])) as Partial<T>;
}

function references(input: string) {
  const values = input.trim().split(/[\s,]+/u).filter(Boolean);
  if (values.some((value) => !/^#?[1-9]\d*$/u.test(value))) throw new Error("Use positive whole reference numbers.");
  const numbers = values.map((value) => Number(value.replace(/^#/u, "")));
  if (numbers.some((number) => !Number.isSafeInteger(number))) throw new Error("Use positive whole reference numbers.");
  return [...new Set(numbers)];
}

function requestFields(fields: TaskFields): CreateTeamTaskInput {
  const { title, description, assigneeId, deadline, status, blocker, entityIds, issueNumbers, pullRequestNumbers } = fields;
  return { title, description, assigneeId, deadline: deadline || null, status, blocker: status === "blocked" ? blocker : null,
    entityIds, issueNumbers: references(issueNumbers), pullRequestNumbers: references(pullRequestNumbers) };
}

function messageFor(status: number) {
  if (status === 403) return "Your current repository permissions do not allow this action.";
  if (status === 404) return "The task is unavailable.";
  return "Couldn’t complete the task action. Try again.";
}

async function taskError(response: Response) {
  if (response.status === 400) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    if (body?.message) return body.message;
  }
  return messageFor(response.status);
}

export function WorkspaceTasksProvider({ repositoryId, children }: { repositoryId: string; children: ReactNode }) {
  const endpoint = "/api/repos/" + encodeURIComponent(repositoryId) + "/tasks";
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<TaskEditor | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const loadingRef = useRef(false);
  const mutation = useRef(false);
  const selected = data?.tasks.find(({ id }) => id === selectedId) ?? null;
  const dirty = Boolean(editor && Object.keys(changesBetween(editor.baseline, editor.fields)).length);

  useEffect(() => {
    if (!dirty && !pending) return;
    function protect(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, pending]);

  const load = useCallback(async () => {
    if (loadingRef.current || mutation.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) setData(null);
        setError(messageFor(response.status));
        return;
      }
      setData(await response.json() as ListResult);
    } catch {
      setError("Couldn’t load team tasks. Try again.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [endpoint]);

  function replaceTask(task: TeamTask) {
    setData((current) => current && {
      ...current,
      tasks: current.tasks.some(({ id }) => id === task.id)
        ? current.tasks.map((stored) => stored.id === task.id ? task : stored)
        : [task, ...current.tasks],
    });
  }

  function cancel() {
    if (mutation.current) return;
    setEditor(null);
    setDeleteConfirmation(null);
    setError("");
  }

  function select(id: string) {
    if (mutation.current || selectedId === id) return;
    if (dirty) {
      setError("Save or cancel your current task edits first.");
      return;
    }
    cancel();
    setStatus("");
    setSelectedId(id);
  }

  function edit(task?: TeamTask) {
    if (!data || mutation.current) return;
    if (dirty) {
      setError("Save or cancel your current task edits first.");
      return;
    }
    const fields = fieldsFor(data.viewerId, task);
    setEditor({ task: task ?? null, baseline: fields, fields, conflict: null });
    setDeleteConfirmation(null);
    setStatus("");
    setError("");
    setSelectedId(task?.id ?? null);
  }

  function change(patch: Partial<TaskFields>) {
    if (mutation.current) return;
    setEditor((current) => current && { ...current, fields: { ...current.fields, ...patch } });
  }

  function resolveConflict(keep: boolean) {
    if (!data || !editor?.conflict || mutation.current) return;
    const task = editor.conflict.task;
    const current = fieldsFor(data.viewerId, task);
    const attempted = keep ? changesBetween(editor.baseline, editor.fields) : {};
    setEditor({ task, baseline: current, fields: { ...current, ...attempted }, conflict: null });
    setError("");
    setStatus(keep ? "Your edits are ready to save against the current version." : "The current saved task is loaded.");
  }

  async function save() {
    if (!data || !editor || editor.conflict || mutation.current || loadingRef.current) return;
    const { task, baseline, fields } = editor;
    const canEditDetails = !task || data.canManage || task.creatorId === data.viewerId;
    let input: CreateTeamTaskInput | { version: number; changes: Partial<CreateTeamTaskInput> };
    try {
      if (task && !canEditDetails) {
        const changes = changesBetween({ status: baseline.status, blocker: baseline.blocker },
          { status: fields.status, blocker: fields.status === "blocked" ? fields.blocker : "" });
        if (!Object.keys(changes).length) return;
        input = { version: task.version, changes: { status: fields.status, blocker: fields.status === "blocked" ? fields.blocker : null } };
      } else {
        const values = requestFields(fields);
        if (task) {
          const changes = changesBetween(requestFields(baseline), values);
          if (!Object.keys(changes).length) return;
          input = { version: task.version, changes };
        } else input = values;
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check the task fields.");
      return;
    }
    mutation.current = true;
    setPending(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(task ? endpoint + "/" + encodeURIComponent(task.id) : endpoint, {
        method: task ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 409) {
        const conflict = await response.json() as TeamTaskConflict;
        replaceTask(conflict.task);
        setEditor((current) => current && { ...current, conflict });
      } else if (response.ok) {
        const { task: saved } = await response.json() as { task: TeamTask };
        replaceTask(saved);
        setSelectedId(saved.id);
        setEditor(null);
        setStatus(task ? "Task saved" : "Task created");
      } else setError(await taskError(response));
    } catch {
      setError("Couldn’t save the task. Your edits are still open.");
    } finally {
      mutation.current = false;
      setPending(false);
    }
  }

  function confirmDelete(task: TeamTask) {
    if (mutation.current) return;
    setDeleteConfirmation({ id: task.id, version: task.version });
    setStatus("");
    setError("");
  }

  async function remove() {
    if (!deleteConfirmation || mutation.current || loadingRef.current) return;
    const { id, version } = deleteConfirmation;
    mutation.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint + "/" + encodeURIComponent(id), {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }), signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 409) {
        const { task } = await response.json() as TeamTaskConflict;
        replaceTask(task);
        setDeleteConfirmation(null);
        setError("The task changed. Review the saved version before confirming deletion again.");
      } else if (response.ok) {
        setData((current) => current && { ...current, tasks: current.tasks.filter((task) => task.id !== id) });
        setSelectedId(null);
        setDeleteConfirmation(null);
        setStatus("Task deleted");
      } else setError(await taskError(response));
    } catch {
      setError("Couldn’t delete the task. Try again.");
    } finally {
      mutation.current = false;
      setPending(false);
    }
  }

  return <TaskContext.Provider value={{
    data, loading, error, status, pending, selected, editor, deleteConfirmation, load, select, edit, change, cancel,
    resolveConflict, save, confirmDelete, cancelDelete: () => setDeleteConfirmation(null), remove,
  }}>{children}</TaskContext.Provider>;
}
