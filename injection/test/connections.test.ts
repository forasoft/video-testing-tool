import { describe, expect, it } from "vitest";
import { forgetConnection } from "src/wrappers/wrap-web-rtc/connections";

// Connections told apart by a label, so that the checks fail if the wrong one is taken out.
const connection = (label: string) => ({ label }) as unknown as RTCPeerConnection;

describe("forgetConnection", () => {
  it("takes the closed connection out of the list", () => {
    const [a, b, c] = [connection("a"), connection("b"), connection("c")];
    const list = [a, b, c];
    forgetConnection(list, b);
    expect(list).toEqual([a, c]);
  });

  it("keeps the other connections when one is closed twice", () => {
    const [a, b, c] = [connection("a"), connection("b"), connection("c")];
    const list = [a, b, c];
    forgetConnection(list, b);
    forgetConnection(list, b);
    expect(list).toEqual([a, c]);
  });

  it("ignores a connection it never had", () => {
    const a = connection("a");
    const list = [a];
    forgetConnection(list, connection("x"));
    expect(list).toEqual([a]);
  });
});
