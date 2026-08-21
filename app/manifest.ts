import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "So-study",
    short_name: "So-study",
    description: "Kit belajar pra-kuliah: baca, tanya, dan latih sebelum kuliah",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
