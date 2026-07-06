// Shared data contracts for the seed registry.
// The harness + downstream agent populate the nullable fields from the
// GitHub API. The site NEVER fabricates these values — a null field renders
// as a clearly-marked empty/placeholder state.

/** Whether it is safe to update an app right now. */
export type SafeToUpdate = 'safe' | 'caution' | 'breaking' | 'unknown' | 'unmaintained';

/** A tracked self-hosted app. See src/data/apps.json. */
export interface App {
  /** URL slug, e.g. "immich". Stable identifier used across routes. */
  slug: string;
  /** Human-readable name, e.g. "Immich". */
  name: string;
  /** GitHub "owner/name", the source of truth for releases. */
  repo: string;
  /** Latest release tag/version. null until the harness fills it. */
  latestVersion: string | null;
  /** LLM-summarized changelog. null until the harness fills it. */
  changelogSummary: string | null;
  /** Update-safety assessment. null (treated as "unknown") until assessed. */
  safeToUpdate: SafeToUpdate | null;
  /** Grounded "why it's safe/caution/breaking" rationale. null until assessed. */
  rationale: string | null;
  /** Provenance: link to the source GitHub release. null until filled. */
  sourceUrl: string | null;
  /** ISO 8601 timestamp of the last check. null until filled. */
  lastChecked: string | null;
  /** Maintained alternative when this app is unmaintained (name or "owner/repo"). null if none. */
  successor?: string | null;
}

/** A curated bundle of apps (the "bookmark engine"). See src/data/stacks.json. */
export interface Stack {
  /** URL slug, e.g. "media". */
  slug: string;
  /** Human-readable name, e.g. "Media server". */
  name: string;
  /** Short description of what the stack is for. */
  description: string;
  /** Slugs referencing entries in apps.json. */
  appSlugs: string[];
}

/** A dated public journal entry. The harness appends these later. */
export interface JournalEntry {
  /** ISO date, e.g. "2026-06-26". Used as the URL slug. */
  date: string;
  /** Entry title. */
  title: string;
  /** Rendered HTML or plain-text body. */
  body: string;
}

/** Normalize a possibly-null safety value to a concrete badge status. */
export function toBadgeStatus(value: SafeToUpdate | null | undefined): SafeToUpdate {
  return value ?? 'unknown';
}
