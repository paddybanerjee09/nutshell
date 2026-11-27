import { beforeEach, expect, test, vi } from "vitest";
import { fixtureGrants, fixtureRepositories, personas } from "./local-fixtures.ts";
import { resetVerificationFixtures, withVerificationLock } from "./verification-reset.ts";

const postgres = vi.hoisted(() => ({
  connect: vi.fn(async () => {}), end: vi.fn(async () => {}),
  query: vi.fn<(statement: string | { text: string }, parameters?: unknown[]) => Promise<{ rows: unknown[] }>>(),
}));
vi.mock("pg", async (load) => {
  const { default: pg } = await load<typeof import("pg")>();
  return { default: { ...pg, Client: class {
    connect = postgres.connect;
    end = postgres.end;
    query = postgres.query;
  } } };
});

const testDatabase = "postgresql://fixture:example@127.0.0.1/nutshell_alpha_test";
const repositoryIds = fixtureRepositories.map(({ id }) => id);
const personaIds = Object.values(personas).map(({ id }) => id);
const statementText = (statement: string | { text: string }) => typeof statement === "string" ? statement.trim() : statement.text;

function replyToReset(statement: string | { text: string }): { rows: unknown[] } {
  const text = statementText(statement);
  if (text.includes("current_database()")) return { rows: [{ database: "nutshell_alpha_test", loopback: true }] };
  if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
  if (text.includes('from "provider_installation"')) return { rows: fixtureRepositories.map(({ installationId }) => [installationId]) };
  if (text.includes('from "repository"')) {
    return { rows: fixtureRepositories.map(({ id, installationId, name, description }) => [id, installationId, name, description]) };
  }
  if (text.includes('from "auth_user"')) return { rows: Object.values(personas).map(({ id, email }) => [id, email]) };
  return { rows: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  postgres.query.mockReset().mockImplementation(async (statement) => replyToReset(statement));
});

test.each([
  testDatabase.replace("nutshell_alpha_test", "nutshell_alpha"),
  testDatabase.replace("nutshell_alpha_test", "other_test"),
  testDatabase.replace("127.0.0.1", "example.invalid"),
  testDatabase + "?dbname=nutshell_alpha",
])("refuses an invalid reset URL before opening PostgreSQL", async (databaseUrl) => {
  await expect(resetVerificationFixtures(databaseUrl)).rejects.toThrow("dedicated local PostgreSQL database (nutshell_alpha_test)");
  expect(postgres.connect).not.toHaveBeenCalled();
});

test.each([
  { database: "nutshell_alpha", loopback: true },
  { database: "nutshell_alpha_test", loopback: false },
])("stops before acquiring a lock if the connected database/address differs", async (target) => {
  postgres.query.mockResolvedValueOnce({ rows: [target] });
  await expect(resetVerificationFixtures(testDatabase)).rejects.toThrow("connected PostgreSQL server");
  expect(postgres.query).toHaveBeenCalledTimes(1);
  expect(postgres.end).toHaveBeenCalledOnce();
});

test("a competing verification operation rejects reset and releases the connection", async () => {
  postgres.query.mockResolvedValueOnce(replyToReset("current_database()"))
    .mockResolvedValueOnce({ rows: [{ locked: false }] });
  const operation = vi.fn(async () => {});
  await expect(withVerificationLock(testDatabase, operation)).rejects.toThrow("Another Nutshell verification operation");
  expect(operation).not.toHaveBeenCalled();
  expect(postgres.query).toHaveBeenCalledTimes(2);
  expect(postgres.end).toHaveBeenCalledOnce();
});

test("resets only confirmed fixture scope and restores grants within one transaction", async () => {
  await resetVerificationFixtures(testDatabase);
  const commands = postgres.query.mock.calls.map(([statement, parameters]) => ({ text: statementText(statement), parameters }));
  expect(commands.at(2)?.text).toBe("begin");
  expect(commands.at(-1)?.text).toBe("commit");
  expect(commands.some(({ text }) => /\b(?:DROP|TRUNCATE)\b/iu.test(text))).toBe(false);

  const deletions = commands.filter(({ text }) => text.startsWith("delete from"));
  expect(deletions.map(({ text }) => /^delete from "([^"]+)"/u.exec(text)?.[1])).toEqual([
    "auth_session", "team_task", "team_note", "markdown_draft", "fixture_draft_proposal", "fixture_setup_proposal",
    "fixture_delivery", "fixture_state", "fixture_history_entry", "fixture_tree", "local_provider_grant", "repository_membership",
  ]);
  expect(deletions[0]?.parameters).toEqual(personaIds);
  expect(deletions.find(({ text }) => text.includes('"fixture_tree"'))?.parameters).toEqual(repositoryIds);
  expect(deletions.find(({ text }) => text.includes('"fixture_delivery"'))?.parameters).toEqual(
    fixtureRepositories.flatMap(({ id, installationId }) => [id, installationId]),
  );
  expect(commands.find(({ text }) => text.startsWith('insert into "local_provider_grant"'))?.parameters).toEqual(
    fixtureGrants.flatMap(({ userId, repositoryId, canRead, canWrite, canConfigure }) => [userId, repositoryId, canRead, canWrite, canConfigure]),
  );
  expect(postgres.end).toHaveBeenCalledOnce();
});

test("refuses a fixture repository associated with live GitHub before any mutations", async () => {
  postgres.query.mockImplementation(async (statement) => statementText(statement).includes('from "github_repository_association"')
    ? { rows: [[repositoryIds[0]]] } : replyToReset(statement));
  await expect(resetVerificationFixtures(testDatabase)).rejects.toThrow("overlap a linked repository");
  const statements = postgres.query.mock.calls.map(([statement]) => statementText(statement));
  expect(statements.at(-1)).toBe("rollback");
  expect(statements.some((statement) => /^(?:update|delete|insert)\b/iu.test(statement))).toBe(false);
  expect(postgres.end).toHaveBeenCalledOnce();
});

test("refuses to reactivate an installation shared with another repository", async () => {
  postgres.query.mockImplementation(async (statement) => {
    const result = replyToReset(statement);
    if (statementText(statement).includes('from "repository"')) {
      result.rows.push([7890, fixtureRepositories[0]!.installationId, "Unrelated project", "Outside the fixture set"]);
    }
    return result;
  });
  await expect(resetVerificationFixtures(testDatabase)).rejects.toThrow("shares a reserved installation");
  const statements = postgres.query.mock.calls.map(([statement]) => statementText(statement));
  expect(statements.at(-1)).toBe("rollback");
  expect(statements.some((statement) => /^(?:update|delete|insert)\b/iu.test(statement))).toBe(false);
});
