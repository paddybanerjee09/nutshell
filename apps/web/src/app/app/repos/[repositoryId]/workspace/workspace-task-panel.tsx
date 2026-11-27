"use client";

import type { TeamTask, TeamTaskStatus } from "@nutshell/server/team-tasks";
import { useEffect, useState } from "react";
import type { WorkspaceData } from "./workspace-data";
import { taskStatusLabels, useWorkspaceTasks } from "./workspace-tasks";
import "./workspace-task-panel.css";

type TasksState = ReturnType<typeof useWorkspaceTasks>;
type ListData = NonNullable<TasksState["data"]>;

function memberName(data: ListData, id: string) {
  return data.members.find((member) => member.id === id)?.name ?? "Unavailable member";
}

function localDate(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

function matchesDeadline(task: TeamTask, filter: string, today: string) {
  if (filter === "none") return !task.deadline;
  if (filter === "today") return task.deadline === today;
  if (filter === "overdue") return Boolean(task.deadline && task.deadline < today && task.status !== "done");
  if (filter === "upcoming") return Boolean(task.deadline && task.deadline > today && task.status !== "done");
  return true;
}

function TaskDetails({ task, data, onOpen }: { task: TeamTask; data: ListData; onOpen?: (id: string) => void }) {
  return <>
    {task.description && <p className="workspace-task-description">{task.description}</p>}
    <dl className="workspace-task-properties">
      <dt>Status</dt><dd>{taskStatusLabels[task.status]}</dd>
      <dt>Assignee</dt><dd>{memberName(data, task.assigneeId)}</dd>
      <dt>Creator</dt><dd>{memberName(data, task.creatorId)}</dd>
      <dt>Deadline</dt><dd>{task.deadline ? <time dateTime={task.deadline}>{task.deadline}</time> : "No deadline"}</dd>
      {task.blocker && <><dt>Blocker reason</dt><dd className="workspace-task-description">{task.blocker}</dd></>}
      <dt>Version</dt><dd>{task.version}</dd>
      {task.entityIds.length > 0 && <>
        <dt>Linked entities</dt>
        <dd><ul>{task.entityIds.map((id) => {
          const entity = data.entities.find((item) => item.id === id);
          return <li key={id}>{entity && onOpen
            ? <button type="button" className="workspace-wikilink" onClick={() => onOpen("entity:" + id)}>{entity.title}</button>
            : entity?.title ?? "Unavailable entity"}</li>;
        })}</ul></dd>
      </>}
      {task.issueNumbers.length > 0 && <><dt>Issues</dt><dd>{task.issueNumbers.map((number) => "#" + number).join(", ")}</dd></>}
      {task.pullRequestNumbers.length > 0 && <><dt>Pull requests</dt><dd>{task.pullRequestNumbers.map((number) => "#" + number).join(", ")}</dd></>}
    </dl>
  </>;
}

function TaskEditorForm({ client, data }: { client: TasksState; data: ListData }) {
  const { editor, pending, loading, change, save, cancel, resolveConflict } = client;
  if (!editor) return null;
  const { fields, task, conflict } = editor;
  const editFields = !task || data.canManage || task.creatorId === data.viewerId;
  const assignees = data.members.filter(({ id }) => data.canManage || id === data.viewerId || id === task?.assigneeId);
  return <form className="workspace-task-editor" aria-label={task ? "Edit task" : "New task"} onSubmit={(event) => {
    event.preventDefault();
    void save();
  }}>
    <h2>{task ? "Edit task" : "New task"}</h2>
    {task && !editFields && <>
      <h3>{task.title}</h3>
      <TaskDetails task={task} data={data} />
    </>}
    {conflict && <div className="workspace-task-conflict">
      <p role="alert">This task changed after you opened it. Your attempted edits are still here.</p>
      <details open>
        <summary>Compare current saved task</summary>
        <h3>{conflict.task.title}</h3>
        <TaskDetails task={conflict.task} data={data} />
      </details>
      <div className="workspace-task-actions">
        <button type="button" onClick={() => resolveConflict(true)}>Keep edits with version {conflict.task.version}</button>
        <button type="button" onClick={() => resolveConflict(false)}>Discard edits and load saved version</button>
      </div>
    </div>}
    <fieldset disabled={pending}>
      {editFields && <>
        <label>Title<input type="text" required value={fields.title} onChange={(event) => change({ title: event.currentTarget.value })} /></label>
        <label>Description<textarea rows={4} value={fields.description} onChange={(event) => change({ description: event.currentTarget.value })} /></label>
        <div className="workspace-task-field-row">
          <label>Assignee<select required value={fields.assigneeId} onChange={(event) => change({ assigneeId: event.currentTarget.value })}>
            {!assignees.some(({ id }) => id === fields.assigneeId) &&
              <option value={fields.assigneeId} disabled>{memberName(data, fields.assigneeId)}</option>}
            {assignees.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label>Deadline<input type="date" value={fields.deadline} onChange={(event) => change({ deadline: event.currentTarget.value })} /></label>
        </div>
      </>}
      <label>Status<select value={fields.status} onChange={(event) => {
        const status = event.currentTarget.value as TeamTaskStatus;
        change({ status, blocker: status === "blocked" ? fields.blocker : "" });
      }}>
        {Object.entries(taskStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
      </select></label>
      {fields.status === "blocked" && <label>Blocker reason
        <textarea required rows={2} value={fields.blocker} onChange={(event) => change({ blocker: event.currentTarget.value })} />
      </label>}
      {editFields && <>
        {data.entities.length > 0 && <fieldset className="workspace-task-entities">
          <legend>Linked entities</legend>
          {data.entities.map((entity) => (
            <label key={entity.id}>
              <input type="checkbox" checked={fields.entityIds.includes(entity.id)} onChange={(event) => change({
                entityIds: event.currentTarget.checked ? [...fields.entityIds, entity.id] : fields.entityIds.filter((id) => id !== entity.id),
              })} />
              <span>{entity.title}</span>
            </label>
          ))}
        </fieldset>}
        <div className="workspace-task-field-row">
          <label>Issue numbers<input type="text" inputMode="numeric" placeholder="1, 2" value={fields.issueNumbers}
            onChange={(event) => change({ issueNumbers: event.currentTarget.value })} /></label>
          <label>Pull request numbers<input type="text" inputMode="numeric" placeholder="3, 4" value={fields.pullRequestNumbers}
            onChange={(event) => change({ pullRequestNumbers: event.currentTarget.value })} /></label>
        </div>
      </>}
    </fieldset>
    <div className="workspace-task-actions">
      <button type="submit" disabled={pending || loading || Boolean(conflict)}>Save task</button>
      <button type="button" disabled={pending} onClick={cancel}>Cancel task edits</button>
    </div>
  </form>;
}

export function WorkspaceTaskPanel({ data: repository, onOpen }: { data: WorkspaceData; onOpen: (id: string) => void }) {
  const client = useWorkspaceTasks();
  const { data, editor, selected, loading, load, pending, status, error, deleteConfirmation } = client;
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState("");
  const [brief, setBrief] = useState<{ id: string; version: number; text: string } | null>(null);
  const [clipboard, setClipboard] = useState("");

  useEffect(() => { void load(); }, [load]);

  const today = localDate(new Date());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const visible = data?.tasks.filter((task) => (!statusFilter || task.status === statusFilter) &&
    (!assigneeFilter || task.assigneeId === assigneeFilter) && matchesDeadline(task, deadlineFilter, today)) ?? [];
  const canEdit = data && selected && (data.canManage || selected.creatorId === data.viewerId || selected.assigneeId === data.viewerId);
  const canDelete = data && selected && (data.canManage || selected.creatorId === data.viewerId);
  const activeBrief = brief && selected?.id === brief.id && selected.version === brief.version ? brief.text : null;

  async function copyBrief(task: TeamTask, list: ListData) {
    const href = new URL(repository.repositoryHref + "/workspace", window.location.origin).href;
    const revision = list.sourceRevision ?? repository.revision;
    const entities = task.entityIds.map((id) => list.entities.find((entity) => entity.id === id)?.title ?? id);
    const text = [
      "# " + task.title, "", "Workspace " + href, "Indexed source revision " + revision,
      "Task " + task.id, "Task version " + task.version, "Status " + taskStatusLabels[task.status],
      "Assignee " + memberName(list, task.assigneeId),
      ...(task.deadline ? ["Deadline " + task.deadline] : []),
      ...(task.blocker ? ["Blocker " + task.blocker] : []),
      ...(entities.length ? ["Linked entities " + entities.join(", ")] : []),
      ...(task.issueNumbers.length ? ["Issues " + task.issueNumbers.map((number) => "#" + number).join(", ")] : []),
      ...(task.pullRequestNumbers.length ? ["Pull requests " + task.pullRequestNumbers.map((number) => "#" + number).join(", ")] : []),
      ...(task.description ? ["", task.description] : []),
    ].join("\n");
    setBrief({ id: task.id, version: task.version, text });
    try {
      await navigator.clipboard.writeText(text);
      setClipboard("Task brief copied");
    } catch {
      setClipboard("Select and copy the task brief.");
    }
  }

  return <section className="workspace-tasks-panel" aria-label="Team tasks">
    <header className="workspace-tasks-header">
      <h1>Team tasks</h1>
      {data && <button type="button" disabled={pending} onClick={() => client.edit()}>New task</button>}
    </header>
    {(pending || status) && <p className="workspace-task-message" role="status">{pending ? "Updating task…" : status}</p>}
    {error && <p className="workspace-task-message" role="alert">{error}</p>}
    {!data ? (
      loading || !error ? <p className="workspace-task-message" role="status">Loading team tasks…</p>
        : <div className="workspace-task-message"><button type="button" onClick={() => void load()}>Retry tasks</button></div>
    ) : <>
      <div className="workspace-task-filters" role="group" aria-label="Task filters">
        <select aria-label="Task status" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
          <option value="">All statuses</option>
          {Object.entries(taskStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        </select>
        <select aria-label="Task assignee" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.currentTarget.value)}>
          <option value="">All assignees</option>
          {data.members.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Task deadline" value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.currentTarget.value)}>
          <option value="">All deadlines</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No deadline</option>
        </select>
        {deadlineFilter && <span className="workspace-task-muted">Deadline filter uses {timeZone} dates.</span>}
      </div>
      {data.truncated && <p className="workspace-task-message workspace-task-muted">Showing {data.tasks.length} recent tasks.</p>}
      <div className="workspace-tasks-body">
        <div className="workspace-task-list">
          <ul role="list" aria-label="Repository tasks">
            {visible.map((task) => (
              <li key={task.id}>
                <button type="button" aria-label={task.title} aria-pressed={selected?.id === task.id} onClick={() => client.select(task.id)}>
                  <span>{task.title}</span>
                  <small>{taskStatusLabels[task.status]} · {memberName(data, task.assigneeId)}
                    {task.deadline && <> · <time dateTime={task.deadline}>{task.deadline}</time></>}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p className="workspace-task-muted">{data.tasks.length ? "No tasks match these filters." : "No repository tasks."}</p>}
        </div>
        {editor ? <TaskEditorForm client={client} data={data} /> : selected && (
          <section className="workspace-task-detail" aria-label="Selected task">
            <h2>{selected.title}</h2>
            <TaskDetails task={selected} data={data} onOpen={onOpen} />
            <div className="workspace-task-actions">
              {canEdit && <button type="button" disabled={pending} onClick={() => client.edit(selected)}>Edit task</button>}
              <button type="button" onClick={() => void copyBrief(selected, data)}>Copy task brief</button>
              {canDelete && !deleteConfirmation &&
                <button type="button" disabled={pending} onClick={() => client.confirmDelete(selected)}>Delete task</button>}
            </div>
            {deleteConfirmation?.id === selected.id && <div className="workspace-task-conflict">
              <p>Delete this repository task?</p>
              <div className="workspace-task-actions">
                <button type="button" disabled={pending || loading} onClick={() => void client.remove()}>Confirm delete</button>
                <button type="button" disabled={pending} onClick={client.cancelDelete}>Cancel deletion</button>
              </div>
            </div>}
            {activeBrief && <>
              <p role="status">{clipboard}</p>
              <label className="workspace-task-brief">Task brief<textarea readOnly rows={8} value={activeBrief} /></label>
            </>}
          </section>
        )}
      </div>
    </>}
  </section>;
}
