'use client';

import { useState, type FormEvent } from 'react';
import type { CreateAvailabilityPayload, WeekDay } from '../lib/api';
import { WEEK_DAYS } from '../lib/psychologist';
import { Icon } from './ui';

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

  const inputClass = 'field';

  return (
    <section className="surface border-2 border-[rgba(54,91,69,0.22)] p-5 sm:p-6 lg:sticky lg:top-24">
      <span className="eyebrow"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sun" />Nuevo bloque</span>
      <h2 className="mt-1.5 flex items-center gap-2 font-serif text-2xl"><Icon name="plus" size={22} className="text-forest" />Agregar horario</h2>
      <p className="mt-2 text-sm text-ink-soft">Este bloque se repetirá cada semana, en hora de Bogotá.</p>
      <form onSubmit={submit} className="mt-5">
        <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
          <legend className="sr-only">Nuevo bloque de disponibilidad</legend>
          <label className="field-label flex flex-col gap-2">Día de la semana
            <select className={inputClass} value={dayOfWeek} onChange={(event) => setDayOfWeek(event.target.value as WeekDay)}>
              {WEEK_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <label className="field-label flex min-w-0 flex-col gap-2">Hora de inicio
              <input type="time" required step={60} value={startTime} onChange={(event) => setStartTime(event.target.value)} className={inputClass} />
            </label>
            <label className="field-label flex min-w-0 flex-col gap-2">Hora de finalización
              <input type="time" required step={60} value={endTime} onChange={(event) => setEndTime(event.target.value)} className={inputClass} />
            </label>
          </div>
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button type="submit" className="btn btn-primary w-full">
            <Icon name="plus" size={18} />{saving ? 'Guardando...' : 'Agregar horario'}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
