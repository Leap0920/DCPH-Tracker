import { NextResponse } from "next/server";

import { getCrimeCategory } from "@/lib/crime-categories";
import { fetchCrimeWikiExtract } from "@/lib/wiki";

/** Public read-only metadata endpoint. No auth required by design. */
export const revalidate = 604800; // 7 days

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const category = getCrimeCategory(slug);

  if (!category) {
    return NextResponse.json({ error: "Unknown crime category" }, { status: 404 });
  }

  const wiki = await fetchCrimeWikiExtract(category);

  return NextResponse.json(
    {
      slug: category.slug,
      label: category.label,
      description: category.description,
      wiki,
    },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    },
  );
}
