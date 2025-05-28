import { sanitizeFilename } from "../src/functions/sanitize-filename";

describe("sanitize-filename", () => {
  it("should replace special characters with underscores", () => {
    const input = "file@name#with$special%chars.xml";
    const expected = "file_name_with_special_chars.xml";
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("should not modify a valid filename", () => {
    const input = "valid-filename_123.xml";
    const expected = "valid-filename_123.xml";
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("should handle filenames with spaces", () => {
    const input = "file name with spaces.xml";
    const expected = "file_name_with_spaces.xml";
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("should handle filenames with multiple special characters", () => {
    const input = "file@name#with$special%chars&more.xml";
    const expected = "file_name_with_special_chars_more.xml";
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("should handle filenames with only special characters", () => {
    const input = '@#$%^&*()[\\/:*?""<>|]';
    const expected = "_____________________";
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("should handle empty filenames", () => {
    const input = "";
    const expected = "";
    expect(sanitizeFilename(input)).toBe(expected);
  });
});
