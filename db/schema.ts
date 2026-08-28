export const schema = {
  appState: {
    table: "app_state",
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
  },
};
