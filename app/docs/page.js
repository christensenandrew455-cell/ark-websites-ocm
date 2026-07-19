import Link from "next/link";
import { HELP_LINKS, HELP_SECTIONS } from "../lib/helpContent";

const linkMap = new Map(HELP_LINKS.map((link) => [link.label, link.href]));

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-16 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm sm:p-9">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 sm:text-xs">ARK Client Center</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Docs and Learn More</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
            Use this guide to understand what the app does, how each part works, and where to find the right controls.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/" className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950 sm:text-sm">Open Clients</Link>
            <Link href="/settings" className="rounded-full border border-slate-600 px-4 py-2 text-xs font-black text-white sm:text-sm">Open Settings</Link>
          </div>
        </header>

        <nav className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:p-6">
          <h2 className="text-lg font-black sm:text-xl">Jump to a topic</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {HELP_SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="rounded-full bg-slate-100 px-3 py-2 text-[11px] font-black text-slate-700 hover:bg-slate-200 sm:text-xs">
                {section.title}
              </a>
            ))}
          </div>
        </nav>

        <div className="mt-4 space-y-4 sm:mt-6 sm:space-y-6">
          {HELP_SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:rounded-3xl sm:p-8">
              <h2 className="text-xl font-black tracking-tight sm:text-3xl">{section.title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-700 sm:text-base sm:leading-7">{section.summary}</p>
              <ul className="mt-4 space-y-2.5 text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-3">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-950" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                {section.links.map((label) => (
                  <Link key={label} href={linkMap.get(label) || "/docs"} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50 sm:text-sm">
                    {label}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
