import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeMessage,
  readMessages,
  markRead,
  writeBroadcast,
  readBroadcasts,
} from "../inbox.js";
import type { Message } from "../inbox.js";

describe("inbox messaging", () => {
  let missionPath: string;

  beforeEach(() => {
    missionPath = mkdtempSync(join(tmpdir(), "mycelium-inbox-test-"));
    // Create inbox structure
    mkdirSync(join(missionPath, "inbox", "arm-1"), { recursive: true });
    mkdirSync(join(missionPath, "inbox", "lead"), { recursive: true });
    mkdirSync(join(missionPath, "inbox", "_broadcast"), { recursive: true });
  });

  afterEach(() => {
    rmSync(missionPath, { recursive: true, force: true });
  });

  describe("writeMessage + readMessages", () => {
    it("writes and reads a message", () => {
      writeMessage(missionPath, "arm-1", "lead", "Please check the logs");

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("lead");
      expect(messages[0].priority).toBe(false);
      expect(messages[0].body).toBe("Please check the logs");
    });

    it("writes priority message", () => {
      writeMessage(missionPath, "arm-1", "lead", "Stop and change approach", true);

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].priority).toBe(true);
    });

    it("returns messages sorted by timestamp", () => {
      writeMessage(missionPath, "arm-1", "lead", "First", false, 1000);
      writeMessage(missionPath, "arm-1", "arm-2", "Second", false, 2000);

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(2);
      expect(messages[0].body).toBe("First");
      expect(messages[1].body).toBe("Second");
    });

    it("returns empty array when no messages", () => {
      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(0);
    });

    it("returns empty array when inbox dir does not exist", () => {
      const messages = readMessages(missionPath, "arm-99");
      expect(messages).toHaveLength(0);
    });
  });

  describe("markRead", () => {
    it("moves message to _read/ directory", () => {
      const filename = writeMessage(missionPath, "arm-1", "lead", "Read me");
      markRead(missionPath, "arm-1", filename);

      // Original gone
      const remaining = readMessages(missionPath, "arm-1");
      expect(remaining).toHaveLength(0);

      // In _read/
      const readDir = join(missionPath, "inbox", "arm-1", "_read");
      expect(existsSync(join(readDir, filename))).toBe(true);
    });

    it("creates _read/ dir if it does not exist", () => {
      const filename = writeMessage(missionPath, "arm-1", "lead", "Read me");
      const readDir = join(missionPath, "inbox", "arm-1", "_read");
      expect(existsSync(readDir)).toBe(false);

      markRead(missionPath, "arm-1", filename);
      expect(existsSync(readDir)).toBe(true);
    });

    it("readMessages excludes _read/ and returns only unread", () => {
      const f1 = writeMessage(missionPath, "arm-1", "lead", "Msg 1", false, 1000);
      writeMessage(missionPath, "arm-1", "lead", "Msg 2", false, 2000);
      markRead(missionPath, "arm-1", f1);

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toBe("Msg 2");
    });
  });

  describe("broadcast", () => {
    it("writes and reads broadcast messages", () => {
      writeBroadcast(missionPath, "lead", "Team announcement");

      const messages = readBroadcasts(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("lead");
      expect(messages[0].body).toBe("Team announcement");
    });

    it("tracks cursor — second read returns empty", () => {
      writeBroadcast(missionPath, "lead", "Announcement", 1000);

      readBroadcasts(missionPath, "arm-1");
      const second = readBroadcasts(missionPath, "arm-1");
      expect(second).toHaveLength(0);
    });

    it("returns new broadcasts after cursor", () => {
      writeBroadcast(missionPath, "lead", "First", 1000);
      readBroadcasts(missionPath, "arm-1"); // advances cursor

      writeBroadcast(missionPath, "lead", "Second", 2000);
      const messages = readBroadcasts(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toBe("Second");
    });
  });
});
