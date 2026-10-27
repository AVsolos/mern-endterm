import { spawn } from "node:child_process";
const processes = [
  spawn(process.execPath, ["--env-file-if-exists=.env", "--experimental-strip-types", "--watch", "server/index.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], { stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const p of processes) p.kill(); process.exitCode = code; }
for (const p of processes) p.on("exit", code => stop(code ?? 1));
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
