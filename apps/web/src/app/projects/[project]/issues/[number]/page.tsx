import IssueDetailClient from "./IssueDetailClient";

export function generateStaticParams(): Array<{ project: string; number: string }> {
  // `output: export` requires at least one param entry for a dynamic segment
  // (an empty array fails the export check). This placeholder is never used at
  // runtime: the embedded CLI server serves index.html as a SPA fallback for
  // every deep link, and IssueDetailClient reads the real params via useParams().
  return [{ project: "_", number: "_" }];
}

export const dynamicParams = false;

export default async function Page({
  params,
}: {
  params: Promise<{ project: string; number: string }>;
}) {
  await params;
  return <IssueDetailClient />;
}
