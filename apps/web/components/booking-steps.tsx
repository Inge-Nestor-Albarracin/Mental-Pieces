import type { ReactNode } from 'react';

// Numbered steps and summary rows shared by the patient's and the reception's booking pages.

export function BookingStep({ number, current, title, children }: { number: number; current: number; title: string; children: ReactNode }) {
  const done = current > number;
  return (
    <section className={`surface p-5 sm:p-6 ${current === number ? 'ring-2 ring-forest/20' : ''}`} aria-labelledby={`step-${number}`}>
      <h2 id={`step-${number}`} className="mb-4 flex items-center gap-3 font-serif text-lg">
        <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-sans text-sm font-semibold ${done ? 'bg-forest text-white' : current === number ? 'border-2 border-primary text-forest' : 'border border-border text-muted-foreground'}`}>
          {done ? '✓' : number}
        </span>
        {title}
        {done && <span className="sr-only">(completado)</span>}
      </h2>
      {children}
    </section>
  );
}

export function SummaryRow({ label, value, capitalize = false }: { label: string; value?: string; capitalize?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${value ? `font-medium text-foreground ${capitalize ? 'first-letter:uppercase' : ''}` : 'italic text-muted-foreground'}`}>{value ?? 'Sin seleccionar'}</dd>
    </div>
  );
}
