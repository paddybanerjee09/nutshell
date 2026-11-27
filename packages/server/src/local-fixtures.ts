export const personas = {
  coordinator: {
    id: "local-coordinator",
    name: "Morgan Chen",
    email: "coordinator@nutshell.invalid",
  },
  reader: {
    id: "local-reader",
    name: "Avery Stone",
    email: "reader@nutshell.invalid",
  },
  other: {
    id: "local-other",
    name: "Robin Patel",
    email: "other@nutshell.invalid",
  },
};

export const fixtureRepositories = [
  {
    id: 1001,
    installationId: 2001,
    name: "Field Notes",
    description: "A synthetic project for collecting and organizing field observations.",
  },
  {
    id: 1002,
    installationId: 2002,
    name: "Harbor Atlas",
    description: "A synthetic project for mapping local waterways and facilities.",
  },
];

export const fixtureGrants = [
  { userId: personas.coordinator.id, repositoryId: 1001, canRead: true, canWrite: true },
  { userId: personas.reader.id, repositoryId: 1001, canRead: true, canWrite: false },
  { userId: personas.other.id, repositoryId: 1002, canRead: true, canWrite: true },
];
