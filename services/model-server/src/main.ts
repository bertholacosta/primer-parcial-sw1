import { startModelServer } from "./runtime.js";

const running = await startModelServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void running.close().finally(() => process.exit(0));
  });
}
