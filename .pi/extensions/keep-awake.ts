import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// keep-awake: prevent the laptop from sleeping/suspending while pi is running an
// agent turn. Linux only (systemd-logind). On non-Linux this is a no-op.
//
// Problem captured from a session: during a long agent loop the OS idle/sleep
// timer fires and suspends the machine (or a lid close suspends it), killing the
// run. We hold a systemd inhibitor for the duration of each turn and release it
// when the turn ends or the session shuts down.

const INHIBIT_WHAT = "sleep:idle:handle-lid-switch";
const INHIBIT_WHY = "pi agent turn running";

export default function (pi: ExtensionAPI) {
  // Child process holding the inhibitor lock, or null when not active.
  let inhibitor: ReturnType<typeof spawn> | null = null;

  const acquire = () => {
    if (process.platform !== "linux") return;
    if (inhibitor && !inhibitor.killed) return;
    inhibitor = spawn(
      "systemd-inhibit",
      ["--what=" + INHIBIT_WHAT, "--why=" + INHIBIT_WHY, "--mode=block", "sleep", "infinity"],
      { stdio: "ignore", detached: true },
    );
  };

  const release = () => {
    if (inhibitor && !inhibitor.killed) {
      try {
        // Negative PID kills the whole process group (inhibitor + sleep).
        process.kill(-inhibitor.pid!, "SIGTERM");
      } catch {
        inhibitor.kill("SIGTERM");
      }
    }
    inhibitor = null;
  };

  pi.on("turn_start", (_event, _ctx) => {
    acquire();
  });

  pi.on("turn_end", (_event, _ctx) => {
    release();
  });

  pi.on("session_shutdown", (_event, _ctx) => {
    release();
  });
}
