export type DocumentSource = "drive" | "docs" | "sheets" | "other";

/** Classify a link so Google Drive files get a recognizable icon. */
export function documentSource(url: string): DocumentSource {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === "drive.google.com") return "drive";
    if (hostname === "docs.google.com") {
      return pathname.startsWith("/spreadsheets") ? "sheets" : "docs";
    }
  } catch {
    // fall through
  }
  return "other";
}

export function documentHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
