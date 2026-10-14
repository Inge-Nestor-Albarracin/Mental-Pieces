import Link from 'next/link';

export default function AdminDashboardPage() {
  return (
    <>
      <p className="text-sm font-medium text-primary">Mental Pieces · Administración</p>
      <h1 className="mt-1 font-serif text-3xl text-foreground sm:text-4xl">Panel administrativo</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Gestiona qué psicólogo atiende a cada paciente. La administración de asignaciones no da acceso al contenido clínico.
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Link href="/admin/clinical-assignments" className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:p-8">
          <p className="text-sm font-medium text-primary">Atención clínica</p>
          <h2 className="mt-2 font-serif text-2xl">Asignaciones clínicas</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Asigna pacientes a psicólogos y finaliza relaciones de atención.</p>
          <span className="mt-6 inline-flex min-h-11 items-center font-medium text-[#47664C] group-hover:underline">Gestionar asignaciones <span aria-hidden="true" className="ml-2">→</span></span>
        </Link>
      </div>
    </>
  );
}
