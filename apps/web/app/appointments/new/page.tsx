'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AppHeader } from '../../../components/app-header';
import {
  createAppointment,
  getAvailableSlots,
  getPsychologists,
  type PsychologistOption,
} from '../../../lib/api';

export default function NewAppointmentPage() {
  const router = useRouter();

  const [psychologists, setPsychologists] =
    useState<PsychologistOption[]>([]);
  const [selectedPsychologist, setSelectedPsychologist] =
    useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [loading, setLoading] = useState(true);
  const [bookingLoading, setBookingLoading] =
    useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    async function loadPsychologists() {
      const token = sessionStorage.getItem('accessToken');

      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const result = await getPsychologists(token);
        setPsychologists(result);
        if (result[0]) {
          setSelectedPsychologist(result[0].id);
        }
      } catch (caughtError) {
        if (caughtError instanceof Error) {
          setError(caughtError.message);
        } else {
          setError('No fue posible cargar los psicólogos.');
        }
      } finally {
        setLoading(false);
      }
    }

    void loadPsychologists();
  }, [router]);

  useEffect(() => {
    const accessToken = sessionStorage.getItem('accessToken');

    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const token = accessToken;

    if (!selectedPsychologist || !selectedDate) {
      setSlots([]);
      setSelectedSlot('');
      return;
    }

    async function loadSlots() {
      try {
        const result = await getAvailableSlots(
          token,
          selectedPsychologist,
          selectedDate,
        );

        setSlots(result);
        setSelectedSlot('');
        setError('');
      } catch (caughtError) {
        if (caughtError instanceof Error) {
          setError(caughtError.message);
        } else {
          setError(
            'No fue posible consultar los horarios disponibles.',
          );
        }
        setSlots([]);
      }
    }

    void loadSlots();
  }, [router, selectedDate, selectedPsychologist]);

  const minDate = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  );

  async function handleSubmit() {
    const token = sessionStorage.getItem('accessToken');

    if (!token) {
      router.replace('/login');
      return;
    }

    if (!selectedPsychologist || !selectedDate || !selectedSlot) {
      setError(
        'Selecciona psicólogo, fecha y horario antes de continuar.',
      );
      return;
    }

    setBookingLoading(true);
    setError('');
    setSuccess('');

    try {
      await createAppointment(token, {
        psychologistId: selectedPsychologist,
        appointmentDate: selectedDate,
        startTime: selectedSlot,
      });

      setSuccess('Cita agendada con éxito.');
      setSelectedDate('');
      setSelectedSlot('');
      setSlots([]);
    } catch (caughtError) {
      if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError('No fue posible agendar la cita.');
      }
    } finally {
      setBookingLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F5F0EB]">
      <AppHeader />

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6">
          <p className="text-sm font-medium text-[#6B8F71]">
            Mental Pieces
          </p>
          <h1 className="mt-1 font-serif text-3xl text-[#2C2420]">
            Agendar cita
          </h1>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {success}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[#DED6CD] bg-white p-6 text-sm text-[#7A6E66]">
            Cargando psicólogos...
          </div>
        ) : (
          <section className="rounded-2xl border border-[#DED6CD] bg-white p-5 shadow-sm sm:p-7">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-[#2C2420]">
                Psicólogo
                <select
                  value={selectedPsychologist}
                  onChange={(event) =>
                    setSelectedPsychologist(event.target.value)
                  }
                  className="rounded-xl border border-[#D8D0C7] bg-[#FFFDFB] px-3 py-2.5 text-sm text-[#2C2420] outline-none focus:border-[#6B8F71] focus:ring-4 focus:ring-[#6B8F71]/10"
                >
                  <option value="">Selecciona un psicólogo</option>
                  {psychologists.map((psychologist) => (
                    <option
                      key={psychologist.id}
                      value={psychologist.id}
                    >
                      {psychologist.fullName ?? 'Psicólogo'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-[#2C2420]">
                Fecha
                <input
                  type="date"
                  min={minDate}
                  value={selectedDate}
                  onChange={(event) =>
                    setSelectedDate(event.target.value)
                  }
                  className="rounded-xl border border-[#D8D0C7] bg-[#FFFDFB] px-3 py-2.5 text-sm text-[#2C2420] outline-none focus:border-[#6B8F71] focus:ring-4 focus:ring-[#6B8F71]/10"
                />
              </label>
            </div>

            {selectedPsychologist && selectedDate && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-medium text-[#2C2420]">
                  Horarios disponibles
                </p>

                {slots.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#D8D0C7] bg-[#FBF8F4] p-4 text-sm text-[#7A6E66]">
                    No hay horarios disponibles para esta fecha.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                          selectedSlot === slot
                            ? 'border-[#6B8F71] bg-[#EEF4EF] text-[#2C2420]'
                            : 'border-[#D8D0C7] bg-white text-[#2C2420] hover:bg-[#F5F0EB]'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  bookingLoading ||
                  !selectedPsychologist ||
                  !selectedDate ||
                  !selectedSlot
                }
                className="rounded-xl bg-[#6B8F71] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#587A5E] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bookingLoading ? 'Agendando...' : 'Confirmar cita'}
              </button>

              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="rounded-xl border border-[#C9BFB5] px-4 py-2.5 text-sm font-medium text-[#4A3F38]"
              >
                Volver al dashboard
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
