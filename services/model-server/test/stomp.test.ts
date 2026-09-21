import { describe, expect, it } from "vitest";
import { encodeStompFrame, parseStompFrame } from "../src/stomp.js";

describe("STOMP framing", () => {
  it("round-trips headers and JSON bodies", () => {
    const encoded = encodeStompFrame("SEND", { destination: "/app/diagrams/abc", receipt: "a:b" }, JSON.stringify({ type: "Heartbeat" }));
    const decoded = parseStompFrame(encoded.slice(0, -1));
    expect(decoded.command).toBe("SEND");
    expect(decoded.headers.destination).toBe("/app/diagrams/abc");
    expect(decoded.headers.receipt).toBe("a:b");
    expect(JSON.parse(decoded.body)).toEqual({ type: "Heartbeat" });
  });
});
