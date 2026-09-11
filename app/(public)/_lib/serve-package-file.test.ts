import { describe, expect, it } from "vitest";
import { javascriptResponse } from "./serve-package-file";

describe("javascriptResponse", () => {
  it("serves the given source byte for byte", async () => {
    const GET = javascriptResponse("export const it = 1;");
    const response = await GET();
    expect(await response.text()).toBe("export const it = 1;");
  });

  it("serves it as a JavaScript module, not the default octet-stream", async () => {
    const GET = javascriptResponse("export const it = 1;");
    const response = await GET();
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });
});
