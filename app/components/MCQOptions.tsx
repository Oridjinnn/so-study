"use client";

type MCQOptionsProps = {
  options: string[];
  chosen?: string | null;
  picked?: string | null;
  answered?: boolean;
  revealed?: boolean;
  skipped?: boolean;
  answer: string;
  onChoose: (opt: string) => void;
  disabled?: boolean;
  name: string;
};

export default function MCQOptions({
  options,
  chosen,
  picked,
  answered,
  revealed,
  skipped,
  answer,
  onChoose,
  disabled = false,
  name,
}: MCQOptionsProps) {
  const effectivePicked = picked ?? chosen ?? null;
  const effectiveRevealed = revealed ?? answered ?? false;
  const effectiveSkipped = skipped ?? false;

  return (
    <div className="mt-2 space-y-1">
      {options.map((opt) => {
        const isCorrect = opt === answer;
        const isChosen = opt === effectivePicked;
        let cls = "border-zinc-300 dark:border-zinc-700";
        if (effectiveSkipped) {
          cls = "border-zinc-200 dark:border-zinc-800 opacity-60";
        } else if (effectiveRevealed && isCorrect) {
          cls = "bg-emerald-900/50 text-emerald-100 border-emerald-500";
        } else if (effectiveRevealed && isChosen && !isCorrect) {
          cls = "bg-red-900/50 text-red-100 border-red-500";
        } else if (!effectiveRevealed && effectivePicked && isChosen) {
          cls =
            "border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-600";
        }
        return (
          <label
            key={opt}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-sm ${cls}`}
          >
            <input
              type="radio"
              name={name}
              value={opt}
              disabled={
                disabled ||
                effectiveSkipped ||
                effectiveRevealed ||
                effectivePicked != null
              }
              checked={isChosen}
              onChange={() => onChoose(opt)}
            />{" "}
            {opt}
            {effectiveRevealed && isCorrect && (
              <span className="ml-auto text-xs font-semibold">benar</span>
            )}
            {effectiveRevealed && isChosen && !isCorrect && (
              <span className="ml-auto text-xs font-semibold">salah</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
