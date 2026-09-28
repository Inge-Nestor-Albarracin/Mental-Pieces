import Link from 'next/link';

export default function PsychologistDashboardPage() {
  return (
    <>
      <p className="text-sm font-medium text-primary">Mental Pieces · Portal del psicólogo</p>
      <h1 className="mt-1 font-serif text-3xl text-foreground sm:text-4xl">Tu espacio de trabajo</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">Organiza tus horarios de atención y consulta las citas de tu agenda.</p>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Link href="/psychologist/appointments" className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:p-8">
          <p className="text-sm font-medium text-primary">Tus citas</p>
          <h2 className="mt-2 font-serif text-2xl">Mi agenda</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Consulta fechas, horarios, pacientes y el estado de tus citas.</p>
          <span className="mt-6 inline-flex min-h-11 items-center font-medium text-[#47664C] group-hover:underline">Consultar agenda <span aria-hidden="true" className="ml-2">→</span></span>
        </Link>
        <Link href="/psychologist/availability" className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:p-8">
          <p className="text-sm font-medium text-primary">Tus horarios</p>
          <h2 className="mt-2 font-serif text-2xl">Mi disponibilidad</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Agrega o elimina los bloques semanales en los que puedes atender.</p>
          <span className="mt-6 inline-flex min-h-11 items-center font-medium text-[#47664C] group-hover:underline">Gestionar disponibilidad <span aria-hidden="true" className="ml-2">→</span></span>
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Todos los horarios se muestran en hora de Bogotá (America/Bogota).</p>
    </>
  );
}
