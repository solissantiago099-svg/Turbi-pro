export const schema = {
  appState: {
    table: "app_state",
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
      revision: "INTEGER NOT NULL DEFAULT 0",
      updatedAt: "TEXT NOT NULL",
      updatedBy: "TEXT",
    },
  },
  appUsers: {
    table: "app_users",
    columns: {
      id: "TEXT PRIMARY KEY",
      username: "TEXT UNIQUE",
      passwordHash: "TEXT",
      email: "TEXT",
      name: "TEXT",
      role: "TEXT NOT NULL DEFAULT 'chofer'",
      currentDriverId: "INTEGER",
      lastSeenAt: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
  },
  appAudit: {
    table: "app_audit",
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      userId: "TEXT",
      userEmail: "TEXT",
      action: "TEXT NOT NULL",
      entity: "TEXT NOT NULL",
      entityId: "TEXT",
      createdAt: "TEXT NOT NULL",
      details: "TEXT",
    },
  },
  appSessions: {
    table: "app_sessions",
    columns: {
      token: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      expiresAt: "TEXT NOT NULL",
    },
  },
};
