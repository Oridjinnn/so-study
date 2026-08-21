export interface MetacogPrompt {
  phase: "rencana" | "pantau" | "evaluasi";
  text: string;
}

export const METACOG_PROMPTS: MetacogPrompt[] = [
  // Rencana — sebelum membaca modul, siapkan diri untuk kuliah
  {
    phase: "rencana",
    text: "Apa 2 pertanyaan utama yang ingin saya jawab dari modul ini sebelum kuliah?",
  },
  {
    phase: "rencana",
    text: "Apa yang sudah saya tahu soal topik ini, dan di mana celah pengetahuan saya?",
  },
  {
    phase: "rencana",
    text: "Tujuan belajar saya untuk modul ini hari ini apa, supaya saya siap saat di kelas?",
  },

  // Pantau — selama membaca, cek pemahaman dengan kata sendiri
  {
    phase: "pantau",
    text: "Konsep mana yang masih kabur saat saya menjelaskannya dengan kata sendiri?",
  },
  {
    phase: "pantau",
    text: "Bagian mana yang saya baca tapi belum benar-benar pahami? Mengapa?",
  },
  {
    phase: "pantau",
    text: "Apakah saya bisa menghubungkan ide ini dengan contoh di kehidupan nyata?",
  },

  // Evaluasi — sesudah belajar, ukur kesiapan menjelaskan di kelas
  {
    phase: "evaluasi",
    text: "Seberapa yakin saya bisa menjelaskan ini di kelas nanti? (1–5)",
  },
  {
    phase: "evaluasi",
    text: "Seberapa siap saya menjawab pertanyaan dosen tentang topik ini? (1–5)",
  },
  {
    phase: "evaluasi",
    text: "Apa satu hal yang harus saya tanyakan di kuliah karena belum saya kuasai? (1–5 keyakinan sudah siap)",
  },
];
