"use client";

type MCQOptionsProps = {
  options: string[];
  chosen?: string | null;
  answered: boolean;
  answer: string;
  onChoose: (opt: string) => void;
  disabled?: boolean;
  name: string;
};

export default function MCQOptions({
  options,
  chosen,
  answered,
  answer,
  onChoose,
  disabled = false,
  name,
}: MCQOptionsProps) {
  return (
    <div className="mt-2 space-y-1">
      {options.map((opt) => {
        const isCorrect = opt === answer;
        const isChosen = opt === chosen;
        let cls = "border-zinc-300 dark:border-zinc-700";
        if (answered && isCorrect)
          cls = "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40";
        else if (answered && isChosen && !isCorrect)
          cls = "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-950/40";
        return (
          <label
            key={opt}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-sm ${cls}`}
          >
            <input
              type="radio"
              name={name}
              value={opt}
              disabled={disabled}
              checked={isChosen}
              onChange={() => onChoose(opt)}
            />{" "}
            {opt}
            {answered && isCorrect && (
              <span className="ml-auto text-xs font-semibold text-emerald-600">benar</span>
            )}
            {answered && isChosen && !isCorrect && (
              <span className="ml-auto text-xs font-semibold text-red-600">salah</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
