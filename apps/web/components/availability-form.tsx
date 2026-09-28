'use client';

import { useState, type FormEvent } from 'react';
import type { CreateAvailabilityPayload, WeekDay } from '../lib/api';
import { WEEK_DAYS } from '../lib/psychologist';

export function AvailabilityForm({ disabled, saving, onSave }: {
  disabled: boolean;
  saving: boolean;
  onSave: (payload: CreateAvailabilityPayload) => Promise<boolean>;
}) {
  const [dayOfWeek, setDayOfWeek] = useState<WeekDay>('MONDAY');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setError('');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      setError('Introduce las horas en formato HH:mm.');
      return;
    }
    if (startTime >= endTime) {
      setError('La hora de finalización debe ser posterior a la hora de inicio.');
      return;
    }
    if (await onSave({ dayOfWeek, startTime, endTime })) {
      setStartTime('');
      setEndTime('');
    }
  }

  const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="font-serif text-xl">Agregar horario</h2>
      <p className="mt-2 text-sm text-muted-foreground">Este bloque se repetirá cada semana, en hora de Bogotá.</p>
      <form onSubmit={submit} className="mt-5">
        <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
          <legend className="sr-only">Nuevo bloque de disponibilidad</legend>
          <label className="flex flex-col gap-2 text-sm font-medium">Día de la semana
            <select className={inputClass} value={dayOfWeek} onChange={(event) => setDayOfWeek(event.target.value as WeekDay)}>
              {WEEK_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">Hora de inicio
              <input type="time" required step={60} value={startTime} onChange={(event) => setStartTime(event.target.value)} className={inputClass} />
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">Hora de finalización
              <input type="time" required step={60} value={endTime} onChange={(event) => setEndTime(event.target.value)} className={inputClass} />
            </label>
          </div>
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
          <button type="submit" className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#587A5E] disabled:cursor-not-allowed">
            {saving ? 'Guardando...' : 'Agregar horario'}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
