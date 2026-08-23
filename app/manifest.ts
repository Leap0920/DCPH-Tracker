import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Detective Conan PH",
    short_name: "DCPH",
    description:
      "The Filipino Detective Conan community: track episodes, join discussions, and prove your rank in the organization.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["entertainment", "social", "utilities"],
    icons: [
      {
        src: "/tab-icon.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/tab-icon.png",
        sizes: "any",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "My Tracker", url: "/tracker" },
      { name: "Rankings", url: "/community/rankings" },
    ],
  };
}
