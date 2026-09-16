// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the status line as a contentinfo landmark", () => {
    render(<SiteFooter siteName="where i go" />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveClass("status-line");
    expect(footer).toHaveTextContent(/where i go/i);
    expect(footer).toHaveTextContent(/solid pod/i);
  });
});
