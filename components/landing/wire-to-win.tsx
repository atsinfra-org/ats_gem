"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import { SectionHeading } from "@/components/landing/section-heading";

const steps = [
  { n: "01", title: "Match", body: "Your saved searches run against every new tender the moment it is crawled — across all 5,000+ sources." },
  { n: "02", title: "Alert", body: "Shortlisted matches reach you on WhatsApp, email or SMS, at the hour you choose. No inbox flood." },
  { n: "03", title: "Prepare", body: "Notices, BOQs, drawings and corrigenda are fetched and kept together, so nothing slips." },
  { n: "04", title: "Track", body: "Deadlines, submissions and results live in one tracker until the work order lands." },
];

const toneColor = {
  red: "var(--color-primary)",
  green: "var(--color-success)",
  blue: "#60a5fa",
  amber: "var(--color-warning)",
  muted: "rgba(255,255,255,0.55)",
};

type LogLine =
  | { time: string; tag: string; tone: keyof typeof toneColor; message: string }
  | { gap: string };

const log: LogLine[] = [
  { time: "09:00:02", tag: "MATCH", tone: "red", message: "38 new tenders match “road works · maharashtra · ≥ ₹1 Cr”" },
  { time: "09:00:03", tag: "RANK", tone: "muted", message: "6 shortlisted · closing ≤ 14 days · EMD ≤ ₹5 L" },
  { time: "09:00:04", tag: "ALERT", tone: "green", message: "whatsapp → +91 98••• ••210 · delivered" },
  { time: "10:41:17", tag: "OPEN", tone: "blue", message: "ATS/MH/2026/1042 · residential complex, Mumbai" },
  { time: "10:41:19", tag: "FETCH", tone: "amber", message: "4 documents · 18.2 MB · BOQ parsed, 212 line items" },
  { time: "16:05:52", tag: "REMIND", tone: "red", message: "submission closes in 48h · 2 documents pending" },
  { gap: "+ 14 days" },
  { time: "11:30:00", tag: "RESULT", tone: "green", message: "L1 by 2.1% · work order issued ✓" },
];

const list: Variants = { show: { transition: { staggerChildren: 0.16 } } };
const line: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] } },
};

export function WireToWin() {
  return (
    <MotionConfig reducedMotion="user">
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <SectionHeading
            tone="dark"
            section="C"
            kicker="How it works"
            title={
              <>
                From the wire <em className="text-primary">to the win.</em>
              </>
            }
            aside="What an ordinary morning looks like once your searches are set up. Nothing here needs you to open a portal."
          />

          <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-16">
            <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1">
              {steps.map((s) => (
                <li key={s.n} className="grid grid-cols-[2.75rem_1fr]">
                  <span className="pt-1 font-mono text-sm text-primary">{s.n}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{s.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-white/55">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="min-w-0 self-start overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 font-mono text-[11px] text-white/55">
                <span>ats-gem ~ alerts.log</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  tail -f
                </span>
              </div>
              <motion.ol
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-80px" }}
                variants={list}
                className="space-y-2.5 p-4 font-mono text-[12px] leading-relaxed sm:p-6 sm:text-[13px]"
              >
                {log.map((l, i) =>
                  "gap" in l ? (
                    <motion.li key={i} variants={line} className="py-2 text-white/55">
                      ── {l.gap} ──
                    </motion.li>
                  ) : (
                    <motion.li key={i} variants={line} className="grid grid-cols-[4rem_1fr] gap-3 sm:grid-cols-[4.75rem_4rem_1fr]">
                      <span className="hidden text-white/55 sm:block">{l.time}</span>
                      <span style={{ color: toneColor[l.tone] }}>{l.tag}</span>
                      <span className="text-white/80">{l.message}</span>
                    </motion.li>
                  )
                )}
                <motion.li variants={line} className="pt-1 text-white/50">
                  ›{" "}
                  <span aria-hidden className="inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-white/70" />
                </motion.li>
              </motion.ol>
            </div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
