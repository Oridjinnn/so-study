import { describe, expect, it, vi, beforeEach } from "vitest";

// Heavy external deps are stubbed: retrieval hits OpenAlex (network) and the
// keyword helpers are pure but irrelevant to tenancy. We only care that the
// caller's ownerId is threaded into the topic resolution so papers land under
// THEIR topic, never a partner's.
vi.mock("@/src/lib/sources", () => ({
  retrieveSources: vi.fn(),
}));
vi.mock("@/src/lib/keywords", () => ({
  expandKeywords: vi.fn(() => []),
  scoringTerms: vi.fn(() => []),
}));
vi.mock("@/src/lib/topics", () => ({
  ensureTopic: vi.fn(),
  resolveCourseMajor: vi.fn(async () => undefined),
}));
vi.mock("@/src/lib/prisma", () => {
  const paper = { upsert: vi.fn() };
  const topicPaper = { upsert: vi.fn() };
  const topic = { update: vi.fn() };
  return { prisma: { paper, topicPaper, topic } };
});

import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";
import { retrieveSources } from "@/src/lib/sources";
import { ensureTopic } from "@/src/lib/topics";
import {
  TEST_USER_ID,
  authedHeaders,
  anonymousHeaders,
} from "@/src/lib/testAuth";

const paper = prisma.paper as unknown as { upsert: ReturnType<typeof vi.fn> };
const topicPaper = prisma.topicPaper as unknown as { upsert: ReturnType<typeof vi.fn> };
const topic = prisma.topic as unknown as { update: ReturnType<typeof vi.fn> };

function req(body: unknown, headers?: { get: (name: string) => string | null }) {
  return {
    json: async () => body,
    headers: headers ?? { get: () => null },
  } as never;
}

const SAMPLE = [
  {
    sourceUrl: "https://openalex.org/W1",
    title: "Kinship in Island Societies",
    authors: "A. B.",
    year: 2021,
    abstract: "x",
    citationCount: 5,
    relevanceScore: 0.8,
    fullTextAvailable: true,
    doi: null,
    venue: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    type: "article",
    provider: "openalex",
    language: "en",
  },
];

describe("POST /api/retrieve", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (retrieveSources as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
    (ensureTopic as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "t-owned" });
    paper.upsert.mockImplementation(async (a: { create?: Record<string, unknown> }) => ({
      id: "p1",
      ...(a.create ?? {}),
    }));
    topicPaper.upsert.mockResolvedValue({ approved: false });
    topic.update.mockResolvedValue({});
  });

  it("401s with no session and never touches the database", async () => {
    const res = await POST(req({ title: "Kinship" }, await anonymousHeaders()));
    expect(res.status).toBe(401);
    expect(ensureTopic).not.toHaveBeenCalled();
    expect(paper.upsert).not.toHaveBeenCalled();
  });

  it("resolves the Topic under the caller's ownerId and persists to it", async () => {
    const res = await POST(req({ title: "Kinship" }, await authedHeaders()));
    expect(res.status).toBe(200);
    // The owner is folded into the topic resolution — this is the whole tenancy
    // guarantee for retrieve.
    expect(ensureTopic).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: TEST_USER_ID, title: "Kinship" }),
    );
    // ...and the TopicPaper join is written to the resolved (owned) topic, never
    // the partner's.
    expect(topicPaper.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { topicId: "t-owned", paperId: "p1", approved: false } }),
    );
    expect(res.status).toBe(200);
  });

  it("never writes to another student's topic when given their topicId", async () => {
    // The caller is the TEST owner, but passes a topicId that belongs to someone
    // else. Because ensureTopic is scoped to THIS ownerId, it must resolve to the
    // caller's OWN topic ("t-owned"), not flip the partner's row.
    const res = await POST(
      req({ title: "Kinship", topicId: "t-theirs" }, await authedHeaders()),
    );
    expect(res.status).toBe(200);
    expect(ensureTopic).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: TEST_USER_ID, topicId: "t-theirs" }),
    );
    const writes = topicPaper.upsert.mock.calls.map((c) => c[0].create.topicId);
    expect(writes).not.toContain("t-theirs");
    expect(writes).toEqual(["t-owned"]);
  });
});
