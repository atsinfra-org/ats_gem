import { SectionHeading } from "@/components/landing/section-heading";
import { cn } from "@/lib/utils";

const figures = [
  { value: "2 hrs", caption: "saved every morning on portal checks" },
  { value: "9 → 1", caption: "portals replaced by a single search" },
  { value: "3×", caption: "more bids submitted per quarter" },
];

const quotes = [
  {
    quote:
      "We used to spend two hours every morning across nine portals. Now the bid team starts the day with a shortlist.",
    name: "Rohan Mehta",
    role: "Head of Tendering, BuildTech Constructions",
  },
  {
    quote: "The deadline reminders alone paid for it. We haven't missed a corrigendum since we switched.",
    name: "Ananya Iyer",
    role: "Procurement Lead, InfraCorp Solutions",
  },
];

const wordmarks = [
  { name: "BuildTech", className: "text-lg font-extrabold tracking-tight" },
  { name: "InfraCorp", className: "text-lg font-semibold tracking-tight" },
  { name: "BharatWorks", className: "font-display text-2xl" },
  { name: "MediSys", className: "text-lg font-medium tracking-wide" },
  { name: "TECHSYSTEMS", className: "font-mono text-sm font-medium tracking-[0.18em]" },
];

export function Voices() {
  return (
    <section className="bg-paper text-ink">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          tone="paper"
          section="D"
          kicker="From the field"
          title={
            <>
              Fewer tabs. <em className="text-primary">More wins.</em>
            </>
          }
          aside="What bid teams tell us after their first quarter on ATS&nbsp;Gem."
        />

        <dl className="grid border-b border-ink/15 sm:grid-cols-3">
          {figures.map((f, i) => (
            <div
              key={f.caption}
              className={cn(
                "flex flex-col-reverse justify-end py-10 sm:px-8",
                i === 0 && "sm:pl-0",
                i > 0 && "border-t border-ink/15 sm:border-l sm:border-t-0"
              )}
            >
              <dt className="mt-3 max-w-[18rem] text-sm leading-relaxed text-ink/60">{f.caption}</dt>
              <dd className="font-display text-6xl leading-none sm:text-7xl">{f.value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid md:grid-cols-2">
          {quotes.map((q, i) => (
            <figure
              key={q.name}
              className={cn("py-12 md:px-10", i === 0 ? "md:pl-0" : "border-t border-ink/15 md:border-l md:border-t-0 md:pr-0")}
            >
              <blockquote className="font-display text-3xl leading-[1.18] sm:text-[2.25rem]">“{q.quote}”</blockquote>
              <figcaption className="mt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-ink/65">
                <span className="text-ink">{q.name}</span> · {q.role}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-5 border-t border-ink/15 pt-8 text-ink/60">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">In use at</span>
          {wordmarks.map((w) => (
            <span key={w.name} className={w.className}>
              {w.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
