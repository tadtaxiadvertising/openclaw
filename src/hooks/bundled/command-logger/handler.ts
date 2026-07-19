/**
 * Example hook handler: Log all commands to a file
 *
 * This handler demonstrates how to create a hook that logs all command events
 * to a centralized log file for audit/debugging purposes.
 *
 * To enable this handler, add it to your config:
 *
 * ```json
 * {
 *   "hooks": {
 *     "internal": {
 *       "enabled": true,
 *       "handlers": [
 *         {
 *           "event": "command",
 *           "module": "./hooks/handlers/command-logger.ts"
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../../../config/paths.js";
import { formatErrorMessage } from "../../../infra/errors.js";
import { appendRegularFile, statRegularFile } from "../../../infra/fs-safe.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import type { HookHandler } from "../../hooks.js";

const log = createSubsystemLogger("command-logger");

/** Maximum command log file size in bytes before rotation (5 MB). */
const MAX_COMMAND_LOG_BYTES = 5 * 1024 * 1024;

/** Maximum number of rotated command log files to keep. */
const MAX_ROTATED_COMMAND_LOGS = 2;

/**
 * Rotate the command log file if it exceeds the size cap.
 * Rotated files follow the pattern: commands.log.1, commands.log.2, etc.
 */
async function rotateCommandLog(logFile: string): Promise<void> {
  try {
    const stat = await statRegularFile(logFile);
    if (!stat || stat.size < MAX_COMMAND_LOG_BYTES) {
      return;
    }

    // Shift existing rotated files: .2 → delete, .1 → .2, active → .1
    for (let i = MAX_ROTATED_COMMAND_LOGS; i >= 1; i--) {
      const rotated = `${logFile}.${i}`;
      try {
        const rotatedStat = await statRegularFile(rotated);
        if (rotatedStat) {
          if (i === MAX_ROTATED_COMMAND_LOGS) {
            await fs.unlink(rotated);
          } else {
            await fs.rename(rotated, `${logFile}.${i + 1}`);
          }
        }
      } catch {
        // Rotated file may not exist; skip silently
      }
    }
    await fs.rename(logFile, `${logFile}.1`);
  } catch (err) {
    const message = formatErrorMessage(err);
    log.warn(`Command log rotation failed: ${message}`);
  }
}

/**
 * Log all command events to a file
 */
const logCommand: HookHandler = async (event) => {
  // Only trigger on command events
  if (event.type !== "command") {
    return;
  }

  try {
    // Create log directory
    const stateDir = resolveStateDir(process.env, os.homedir);
    const logDir = path.join(stateDir, "logs");
    await fs.mkdir(logDir, { recursive: true });

    // Rotate log if it exceeds size cap
    const logFile = path.join(logDir, "commands.log");
    await rotateCommandLog(logFile);

    // Append to command log file
    const logLine =
      JSON.stringify({
        timestamp: event.timestamp.toISOString(),
        action: event.action,
        sessionKey: event.sessionKey,
        senderId: event.context.senderId ?? "unknown",
        source: event.context.commandSource ?? "unknown",
      }) + "\n";

    await appendRegularFile({
      filePath: logFile,
      content: logLine,
      rejectSymlinkParents: true,
    });
  } catch (err) {
    const message = formatErrorMessage(err);
    log.error(`Failed to log command: ${message}`);
  }
};

export default logCommand;
