"use client";

import { useState } from "react";
import type { ModuleDetail } from "../lib/types";
import Markdown from "../lib/markdown";
import FreeRecall from "./FreeRecall";
import { INPUT_CLASS, PRIMARY_CLASS, CHIP_CLASS } from "./ui";

type Props = {
  detail: ModuleDetail;
  online: boolean;
  postJSON: (url: string, body: unknown) => Promise<Record<string, unknown>>;
  recallDone: boolean;
  onRecallDone: (done: boolean) => void;
  onError: (msg: string | null) => void;
  onStatus: (msg: string) => void;
};

export default function AskStep({
  detail,
  online,
  postJSON,
  recallDone,
  onRecallDone,
  onError,
  onStatus,
}: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  async function doAsk() {
    if (!question.trim()) {
      onError("Tulis pertanyaan dulu.");
      return;
    }
    if (!online) {
      onError("Tanya-jawab butuh internet. Sambungkan dulu.");
      return;
    }
    setAsking(true);
    onStatus("Mencari jawaban di modul…");
    try {
      const data = await postJSON("/api/qa", {
        moduleId: detail.id,
        question,
        topicId: detail.topicId,
      });
      setAnswer(data.answer as string);
      onStatus("Jawaban siap.");
    } catch (e) {
      onError((e as Error).message);
      onStatus("");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section id="panel-ask" role="tabpanel" aria-labelledby="tab-ask" className="space-y-3">
      {recallDone ? (
        <>
          <label htmlFor="qa-question" className="sr-only">
            Pertanyaan tentang modul ini
          </label>
          <textarea
            id="qa-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="Tanya sesuatu dari modul ini…"
            className={INPUT_CLASS}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doAsk} disabled={asking} className={PRIMARY_CLASS}>
              {asking ? "Menjawab…" : "Tanya"}
            </button>
            <button type="button" onClick={() => onRecallDone(false)} className={CHIP_CLASS}>
              Tulis ulang ingatan
            </button>
          </div>
          {answer && (
            <article className="reader-prose rounded-card border border-border bg-card p-5">
              <Markdown text={answer} />
            </article>
          )}
        </>
      ) : (
        <FreeRecall
          topicId={detail.topicId}
          topicTitle={detail.topicTitle}
          onDone={() => onRecallDone(true)}
        />
      )}
    </section>
  );
}
