import { Reveal } from '../ui/Reveal';

const STEPS = [
  { n: '01', title: 'Search your area', body: 'Enter a city, ZIP code or address — or share your location only if you choose to.' },
  { n: '02', title: 'Explore real communities', body: 'See apartment communities from connected location data, with photos, address and contact details where available.' },
  { n: '03', title: 'Check the policy label', body: 'Each property shows whether its rental-screening policy is verified, potentially flexible, or not yet confirmed.' },
  { n: '04', title: 'Contact the leasing office', body: 'Call or get directions directly. Always confirm current pricing, availability and screening requirements.' },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="pb-24 pt-4 md:pb-28">
      <div className="container-site">
        <Reveal>
          <p className="eyebrow">How it works</p>
          <h2 id="how-title" className="section-title mt-3">
            Four honest steps to your next home
          </h2>
        </Reveal>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.n} className="rounded-[24px] bg-white shadow-card ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-500 ease-lux hover:-translate-y-1 hover:shadow-float">
              <Reveal delay={i * 0.05} className="h-full p-7">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-navy-700 text-[13px] font-bold text-white">{s.n}</span>
                <h3 className="mt-5 text-[18px] font-extrabold tracking-[-0.02em] text-navy-900">{s.title}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-charcoal/70">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
