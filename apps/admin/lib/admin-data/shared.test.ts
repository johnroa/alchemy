import { describe, expect, it } from "vitest";
import { COUNTABLE_TABLE_COLUMNS } from "./shared";

describe("COUNTABLE_TABLE_COLUMNS", () => {
  it("uses a real cookbook_entries column for exact row counts", () => {
    expect(COUNTABLE_TABLE_COLUMNS.cookbook_entries).toBe("user_id");
  });
});
