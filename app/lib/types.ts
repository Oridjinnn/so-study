// Type-only import: erased at compile time, so this DTO module stays runtime-free
// while `SourcePaper.type` reuses the one canonical work-type union instead of
// duplicating it (rule I12: no drift between the source contract and the DTO).
import type { PaperType } from "@/src/lib/sources/types";
// The verification payload types live with the logic that produces them
// (src/lib/verification.ts → src/lib/tier1.ts / critic.ts / gauge.ts) and are
// re-exported here so UI code keeps importing its DTOs from one place without a
// second, drift-prone copy of the shapes.
import type { VerificationPayload } from "@/src/lib/verification";

export type { VerificationPayload };
export type { Tier1Report, Tier1Finding, Tier1Check, Tier1Severity } from "@/src/lib/tier1";
export type { CriticReport, CriticFlag, CriticVerdict } from "@/src/lib/critic";
export type { GaugeResult, GaugeBand, GaugeBreakdown } from "@/src/lib/gauge";

export interface CandidatePaper {
  id: string;
  title: string;
  authors: string;
  year: number;
  abstract: string;
  citationCount: number;
  relevanceScore: number;
  sourceUrl: string;
  fullTextAvailable: boolean;
  approved: boolean;
  /** ISO-639-1 language code when known ("id" | "en" | …), else null. */
  language?: string | null;
  /** Journal/conference/series title, when known (mirrors SourcePaper.venue). */
  venue?: string | null;
  /** Bibliographic type, when known (mirrors SourcePaper.type). */
  type?: PaperType | null;
}

export interface SourcePaper {
  id: string;
  title: string;
  authors: string;
  year: number;
  citationCount: number;
  sourceUrl: string;
  // Bibliographic metadata for APA-7 references (src/lib/citation.ts). Mirrors
  // the nullable Paper columns served by `GET /api/modules/[id]` — optional
  // because rows retrieved before those columns existed do not carry them
  // (rule I12: this DTO stays in sync with the route that produces it).
  doi?: string | null;
  venue?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  type?: PaperType | null;
}

export interface ModuleVersion {
  id: string;
  version: number;
  generatedAt: string;
  changeNote: string | null;
}

export interface ModuleRef {
  id: string;
  title: string;
  status: string;
  topicId: string;
  weekNumber?: number | null;
  dueBeforeLecture?: string | null;
  /** "official_rps" once confirmed against the lecturer order, else "custom". */
  orderSource?: string;
}

export interface TopicRef {
  id: string;
  title: string;
  status: string;
  courseId: string;
  weekNumber?: number | null;
  dueBeforeLecture?: string | null;
  /** "official_rps" once confirmed against the lecturer order, else "custom". */
  orderSource?: string;
}

export interface CourseSummary {
  id: string;
  name: string;
  /** Jurusan; drives retrieval + synthesis framing. Null on legacy courses. */
  major?: string | null;
  modules: ModuleRef[];
  topics: TopicRef[];
}

export interface ModuleDetail {
  id: string;
  topicId: string;
  topicTitle: string;
  contentMarkdown: string;
  generatedAt: string;
  wordCount: number | null;
  pageCount: number | null;
  essayPrompt: string | null;
  essayRubric: string | null;
  courses: { id: string; name: string }[];
  sourcePapers: SourcePaper[];
  versions: ModuleVersion[];
  /**
   * Two-tier accuracy verification for THIS content. `verification.gauge` is
   * null when Tier 1 has never run (modules generated before the gate existed);
   * `verification.tier1.blocked` is the hard shipping gate.
   */
  verification?: VerificationPayload;
}

export interface AssessmentAttempt {
  id: string;
  moduleId: string;
  topicId: string;
  questionType: "mcq" | "essay";
  itemRef: string;
  prompt: string;
  response: string | null;
  score: number | null;
  isCorrect: boolean | null;
  confidence: number | null;
  answeredAt: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  stability: number;
  difficulty: number;
  scheduledNextAt: string | null;
}

export interface QuestionBankItem {
  id: string;
  topicId: string;
  moduleId: string | null;
  stem: string;
  options: string[];
  answer: string;
  explanation: string | null;
  author: "ai" | "student";
  createdAt: string;
  updatedAt: string;
}

export interface MCQQuestion {
  id: string;
  stem: string;
  options: string[];
  answer: string;
  explanation?: string;
}

export interface UsageRow {
  kind: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
}

// ---------------------------------------------------------------------------
// RPS reconciliation (`GET/PUT /api/rps/[courseId]`)
//
// Mirrors the payload produced by `app/api/rps/[courseId]/route.ts`, whose rows
// come from the pure differ in `src/lib/rps.ts`. Keep in sync (rule I12).
// ---------------------------------------------------------------------------

export type RPSRowStatus = "aligned" | "moved" | "not_in_official" | "not_started";

export interface RPSDiffRow {
  title: string;
  topicId: string | null;
  officialPosition: number | null;
  customPosition: number | null;
  delta: number | null;
  status: RPSRowStatus;
}

export interface RPSSummary {
  aligned: number;
  moved: number;
  notInOfficial: number;
  notStarted: number;
}

export interface RPSState {
  courseId: string;
  courseName: string;
  hasOfficialOrder: boolean;
  officialOrder: string[];
  rows: RPSDiffRow[];
  summary: RPSSummary;
  reconciledAt: string | null;
  /** Topics still on a self-chosen order (`orderSource !== "official_rps"`). */
  unverifiedCount: number;
}

// ---------------------------------------------------------------------------
// Progress (`GET /api/progress?courseId=`)
//
// Single source of truth for the progress payload shape, shared by the hub
// (`app/page.tsx`) and any panel that reads progress. The response is produced
// by `app/api/progress/route.ts`; these interfaces mirror that contract
// exactly — keep them in sync (rule I12: no doc/code drift).
// ---------------------------------------------------------------------------

export interface TopicProgress {
  topicId: string;
  title: string;
  hasModule: boolean;
  status: string;
  dueBeforeLecture: string | null;
  /** `dueBeforeLecture` falls on or before end-of-today (Asia/Jakarta). */
  dueToday: boolean;
  /** next scheduled review is before start-of-today (Asia/Jakarta). */
  overdue: boolean;
  attempts: number;
  /** 0..100 share of correct attempts; essay attempts are excluded. */
  masteryPct: number;
  nextReview: string | null;
}

/** One day of the 30-day practice heatmap (Asia/Jakarta day keys). */
export interface ProgressHeatmapEntry {
  date: string;
  count: number;
}

export interface ProgressData {
  topics: TopicProgress[];
  dueTodayCount: number;
  dueTodayByCourse: Record<string, number>;
  streakDays: number;
  heatmap: ProgressHeatmapEntry[];
  avgMastery: number | null;
}
