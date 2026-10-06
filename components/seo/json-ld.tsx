/** Renders schema.org JSON-LD. Only pass facts that are true and visible on the page. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // `<` is escaped so page-derived strings can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\u003c") }} />;
}
