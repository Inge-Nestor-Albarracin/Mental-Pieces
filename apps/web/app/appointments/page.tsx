'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AppHeader } from '../../components/app-header';
import {
  cancelAppointment,
  getAvailableSlots,
  getMyAppointments,
  rescheduleAppointment,
  type AppointmentSummary,
} from '../../lib/api';

export default function AppointmentsPage() {
  const router = useRouter();

  const [appointments, setAppointments] =
    useState<AppointmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rescheduleId, setRescheduleId] =
    useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] =
    useState('');
  const [rescheduleSlots, setRescheduleSlots] =
    useState<string[]>([]);
  const [rescheduleSlot, setRescheduleSlot] =
    useState('');
  const [rescheduleError, setRescheduleError] =
    useState('');
  const [pendingActionId, setPendingActionId] =
    useState<string | null>(null);

  async function loadAppointments() {
    const token = sessionStorage.getItem('accessToken');

    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      const result = await getMyAppointments(token);
      setAppointments(result);
      setError('');
    } catch (caughtError) {
      if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError('No fue posible cargar tus citas.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAppointments();
  }, [router]);

  useEffect(() => {
    if (!rescheduleId || !rescheduleDate) {
      return;
    }

    const accessToken = sessionStorage.getItem('accessToken');

    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const token = accessToken;

    const appointment = appointments.find(
      (item) => item.id === rescheduleId,
    );

    if (!appointment) {
      return;
    }

    const psychologistId = appointment.psychologist?.id;

    if (!psychologistId) {
      setRescheduleError(
        'No se pudo identificar al psicólogo de la cita.',
      );
      return;
    }

    async function fetchSlots() {
      try {
        const slots = await getAvailableSlots(
          token,
          psychologistId,
          rescheduleDate,
        );

        setRescheduleSlots(slots);
        setRescheduleSlot('');
        setRescheduleError('');
      } catch (caughtError) {
        if (caughtError instanceof Error) {
          setRescheduleError(caughtError.message);
        } else {
          setRescheduleError(
            'No fue posible consultar horarios disponibles.',
          );
        }
        setRescheduleSlots([]);
      }
    }

    void fetchSlots();
  }, [appointments, rescheduleId, rescheduleDate, router]);

  async function handleCancel(appointmentId: string) {
    const token = sessionStorage.getItem('accessToken');

    if (!token) {
      router.replace('/login');
      return;
    }

    const confirmed = window.confirm(
      '¿Deseas cancelar esta cita?',
    );

    if (!confirmed) {
      return;
    }

    setPendingActionId(appointmentId);

    try {
      await cancelAppointment(token, appointmentId);
      await loadAppointments();
    } catch (caughtError) {
      if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError('No fue posible cancelar la cita.');
      }
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleRescheduleSubmit(
    appointmentId: string,
  ) {
    if (!rescheduleDate || !rescheduleSlot) {
      setRescheduleError(
        'Selecciona una fecha y una hora disponibles.',
      );
      return;
    }

    const token = sessionStorage.getItem('accessToken');

    if (!token) {
      router.replace('/login');
      return;
    }

    setPendingActionId(appointmentId);
    setRescheduleError('');

    try {
      await rescheduleAppointment(token, appointmentId, {
        appointmentDate: rescheduleDate,
        startTime: rescheduleSlot,
      });

      setRescheduleId(null);
      setRescheduleDate('');
      setRescheduleSlot('');
      setRescheduleSlots([]);
      await loadAppointments();
    } catch (caughtError) {
      if (caughtError instanceof Error) {
        setRescheduleError(caughtError.message);
      } else {
        setRescheduleError(
          'No fue posible reagendar la cita.',
        );
      }
    } finally {
      setPendingActionId(null);
    }
  }

  const scheduledAppointments = appointments.filter(
    (appointment) => appointment.status === 'SCHEDULED',
  );

  const cancelledAppointments = appointments.filter(
    (appointment) => appointment.status === 'CANCELLED',
  );

  return (
    <main className="min-h-screen bg-[#F5F0EB]">
      <AppHeader />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#6B8F71]">
              Mental Pieces
            </p>
            <h1 className="mt-1 font-serif text-3xl text-[#2C2420]">
              Mis citas
            </h1>
          </div>

          <button
            type="button"
            onClick={() => router.push('/appointments/new')}
            className="rounded-xl bg-[#6B8F71] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#587A5E]"
          >
            Agendar cita
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[#DED6CD] bg-white p-6 text-sm text-[#7A6E66]">
            Cargando citas...
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-2xl border border-[#DED6CD] bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-[#2C2420]">
                Programadas
              </h2>

              {scheduledAppointments.length === 0 ? (
                <p className="text-sm text-[#7A6E66]">
                  No tienes citas programadas.
                </p>
              ) : (
                <div className="space-y-4">
                  {scheduledAppointments.map((appointment) => (
                    <article
                      key={appointment.id}
                      className="rounded-2xl border border-[#DED6CD] bg-[#FDFBF9] p-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#6B8F71]">
                            {new Date(
                              `${appointment.appointmentDate}T12:00:00`,
                            ).toLocaleDateString('es-CO', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </p>

                          <p className="mt-2 text-lg font-semibold text-[#2C2420]">
                            {appointment.startTime} -{' '}
                            {appointment.endTime}
                          </p>

                          <p className="mt-1 text-sm text-[#7A6E66]">
                            {appointment.psychologist.fullName ?? 'Psicólogo'}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRescheduleId(appointment.id);
                              setRescheduleDate(
                                appointment.appointmentDate,
                              );
                              setRescheduleSlot('');
                              setRescheduleError('');
                            }}
                            className="rounded-xl border border-[#6B8F71] px-3 py-2 text-sm font-medium text-[#6B8F71] transition hover:bg-[#EEF4EF]"
                          >
                            Reagendar
                          </button>

                          <button
                            type="button"
                            disabled={pendingActionId === appointment.id}
                            onClick={() =>
                              handleCancel(appointment.id)
                            }
                            className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                          >
                            {pendingActionId === appointment.id
                              ? 'Cancelando...'
                              : 'Cancelar'}
                          </button>
                        </div>
                      </div>

                      {rescheduleId === appointment.id && (
                        <div className="mt-4 rounded-xl border border-[#E5DDD5] bg-white p-4">
                          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
                            <label className="flex flex-col gap-2 text-sm font-medium text-[#2C2420]">
                              Nueva fecha
                              <input
                                type="date"
                                min={new Date().toISOString().slice(0, 10)}
                                value={rescheduleDate}
                                onChange={(event) =>
                                  setRescheduleDate(
                                    event.target.value,
                                  )
                                }
                                className="rounded-xl border border-[#D8D0C7] bg-[#FFFDFB] px-3 py-2.5 text-sm text-[#2C2420] outline-none focus:border-[#6B8F71] focus:ring-4 focus:ring-[#6B8F71]/10"
                              />
                            </label>

                            <div className="flex flex-col gap-2 text-sm font-medium text-[#2C2420]">
                              <span>Hora disponible</span>

                              {rescheduleSlots.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-[#D8D0C7] bg-[#FBF8F4] px-3 py-2.5 text-sm text-[#7A6E66]">
                                  Sin horarios disponibles para esa fecha.
                                </p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {rescheduleSlots.map((slot) => (
                                    <button
                                      key={slot}
                                      type="button"
                                      onClick={() =>
                                        setRescheduleSlot(slot)
                                      }
                                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                                        rescheduleSlot === slot
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
                          </div>

                          {rescheduleError && (
                            <p className="mt-3 text-sm text-red-700">
                              {rescheduleError}
                            </p>
                          )}

                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                handleRescheduleSubmit(appointment.id)
                              }
                              disabled={
                                pendingActionId === appointment.id ||
                                !rescheduleSlot
                              }
                              className="rounded-xl bg-[#6B8F71] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pendingActionId === appointment.id
                                ? 'Guardando...'
                                : 'Guardar nuevo horario'}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setRescheduleId(null);
                                setRescheduleDate('');
                                setRescheduleSlots([]);
                                setRescheduleSlot('');
                                setRescheduleError('');
                              }}
                              className="rounded-xl border border-[#C9BFB5] px-4 py-2.5 text-sm font-medium text-[#4A3F38]"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#DED6CD] bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-[#2C2420]">
                Canceladas
              </h2>

              {cancelledAppointments.length === 0 ? (
                <p className="text-sm text-[#7A6E66]">
                  No tienes citas canceladas.
                </p>
              ) : (
                <div className="space-y-3">
                  {cancelledAppointments.map((appointment) => (
                    <div
                      key={appointment.id}
                      className="rounded-xl border border-[#E9E0D8] bg-[#F9F4F0] p-4"
                    >
                      <p className="text-sm font-medium text-[#2C2420]">
                        {new Date(
                          `${appointment.appointmentDate}T12:00:00`,
                        ).toLocaleDateString('es-CO', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="mt-1 text-sm text-[#7A6E66]">
                        {appointment.startTime} - {appointment.endTime}
                        {' · '}
                        {appointment.psychologist.fullName ?? 'Psicólogo'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
