/**
 * @returns sanitized filename that will work on Windows
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9-_.]/g, "_");
}
