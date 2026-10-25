'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { PageIntro } from '../../../components/app-shell';
import { EmptyState, Eyebrow, Icon, Notice, StatusPill, type PillTone } from '../../../components/ui';
import { createInternalUser, getInternalUsers, type InternalRole, type InternalUser } from '../../../lib/api';
import {
  EMPTY_INTERNAL_USER_FORM,
  INTERNAL_ROLE_LABEL,
  INTERNAL_ROLE_OPTIONS,
  internalUserErrorMessage,
  toCreatePayload,
  validateInternalUser,
  type InternalUserForm,
} from '../../../lib/internal-users';
import { isAccessError, portalError, requireSessionToken } from '../../../lib/psychologist';

const ROLE_TONE: Record<InternalRole, PillTone> = { PSYCHOLOGIST: 'blue', STAFF: 'violet' };

type Filter = 'ALL' | InternalRole;

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota',
  }).format(new Date(value));
}

export default function InternalUsersPage() {
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>('ALL');

  const [form, setForm] = useState<InternalUserForm>(EMPTY_INTERNAL_USER_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const first = await getInternalUsers(requireSessionToken(), 1);
        if (!active) return;
        setUsers(first.items);
        setPage(1);
        setHasMore(first.hasMore);
      } catch (caught) {
        if (!active) return;
        setUsers([]);
        setError(portalError(caught, 'No fue posible cargar los usuarios. Revisa tu conexión y reintenta.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [revision]);

  function refresh() {
    setLoading(true);
    setError(null);
    setRevision((value) => value + 1);
  }

  function update<K extends keyof InternalUserForm>(key: K, value: InternalUserForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await getInternalUsers(requireSessionToken(), page + 1);
      setUsers((current) => [...current, ...next.items]);
      setPage(next.page);
      setHasMore(next.hasMore);
    } catch (caught) {
      setError(portalError(caught, 'No fue posible cargar más usuarios.'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    const problem = validateInternalUser(form);
    if (problem) {
      setFormError(problem);
      return;
    }
    setCreating(true);
    try {
      const created = await createInternalUser(requireSessionToken(), toCreatePayload(form));
      // The initial password is not kept anywhere once the account exists.
      setForm(EMPTY_INTERNAL_USER_FORM);
      setShowPassword(false);
      setSuccess(`Cuenta creada: ${created.fullName ?? created.email} (${INTERNAL_ROLE_LABEL[created.role]}). Ya puede iniciar sesión con ${created.email}.`);
      refresh();
    } catch (caught) {
      const failure = portalError(caught, '');
      if (isAccessError(failure)) {
        setUsers([]);
        setError(failure);
      } else {
        setFormError(internalUserErrorMessage(caught));
      }
    } finally {
      setCreating(false);
    }
  }

  const blocked = loading || isAccessError(error);
  const counts = {
    ALL: users.length,
    PSYCHOLOGIST: users.filter((user) => user.role === 'PSYCHOLOGIST').length,
    STAFF: users.filter((user) => user.role === 'STAFF').length,
  };
  const visible = filter === 'ALL' ? users : users.filter((user) => user.role === filter);
  const more = hasMore ? '+' : '';

  return (
    <>
      <PageIntro
        kicker="Administración"
        title="Usuarios internos"
        description="Crea las cuentas de psicólogos y del staff. El registro público del inicio de sesión solo crea cuentas de pacientes."
        actions={<button type="button" onClick={refresh} disabled={blocked} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar</button>}
      />

      {error && <ApiErrorNotice error={error} onRetry={refresh} />}
      {success && <Notice tone="success">{success}</Notice>}

      {isAccessError(error) ? null : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <section aria-labelledby="new-user" className="surface h-fit border-2 border-[rgba(54,91,69,0.22)] p-5 sm:p-6 lg:sticky lg:top-24">
            <Eyebrow>Nueva cuenta</Eyebrow>
            <h2 id="new-user" className="mt-1.5 flex items-center gap-2 font-serif text-2xl"><Icon name="userPlus" size={21} className="text-forest" />Crear usuario</h2>
            <form onSubmit={submit} noValidate className="mt-5">
              <fieldset disabled={creating} className="space-y-4">
                <fieldset>
                  <legend className="field-label mb-2">Tipo de cuenta</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {INTERNAL_ROLE_OPTIONS.map((option) => {
                      const selected = form.role === option.value;
                      return (
                        <label key={option.value} className={`flex min-h-24 cursor-pointer flex-col gap-1.5 rounded-2xl border-2 p-4 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest ${selected ? 'border-forest bg-mint shadow-[var(--shadow-soft)] ring-4 ring-[rgba(54,91,69,0.12)]' : 'border-border bg-paper hover:border-[rgba(54,91,69,0.4)]'}`}>
                          <input type="radio" name="role" value={option.value} checked={selected} onChange={() => update('role', option.value)} className="sr-only" />
                          <span className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 font-semibold"><Icon name={option.value === 'PSYCHOLOGIST' ? 'heart' : 'users'} size={18} className="text-forest" />{option.label}</span>
                            <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-forest bg-forest text-white' : 'border-border'}`}>
                              {selected && <Icon name="check" size={12} />}
                            </span>
                          </span>
                          <span className="text-xs leading-relaxed text-ink-soft">{option.description}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <Field id="user-name" label="Nombre completo">
                  <input id="user-name" className="field" autoComplete="off" value={form.fullName} onChange={(event) => update('fullName', event.target.value)} maxLength={120} required />
                </Field>
                <Field id="user-email" label="Correo electrónico" hint="Con este correo iniciará sesión.">
                  <input id="user-email" type="email" className="field" autoComplete="off" value={form.email} onChange={(event) => update('email', event.target.value)} required />
                </Field>
                <Field id="user-password" label="Contraseña inicial" hint="Mínimo 8 caracteres. Compártela por un canal seguro.">
                  <div className="relative">
                    <input id="user-password" type={showPassword ? 'text' : 'password'} className="field pr-12" autoComplete="new-password" value={form.password} onChange={(event) => update('password', event.target.value)} minLength={8} maxLength={72} required />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-soft hover:text-forest">
                      <Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} />
                    </button>
                  </div>
                </Field>
                <Field id="user-password-confirm" label="Confirmar contraseña">
                  <input id="user-password-confirm" type={showPassword ? 'text' : 'password'} className="field" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} maxLength={72} required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <Field id="user-phone" label="Teléfono (opcional)">
                    <input id="user-phone" type="tel" className="field" autoComplete="off" value={form.phone} onChange={(event) => update('phone', event.target.value)} maxLength={25} />
                  </Field>
                  <Field id="user-position" label="Cargo (opcional)">
                    <input id="user-position" className="field" autoComplete="off" value={form.position} onChange={(event) => update('position', event.target.value)} maxLength={100}
                      placeholder={form.role === 'STAFF' ? 'Ej.: Recepción' : 'Ej.: Psicólogo clínico'} />
                  </Field>
                </div>

                {formError && <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><Icon name="alert" size={17} className="mt-0.5 shrink-0" />{formError}</p>}
                <button type="submit" className="btn btn-primary w-full">
                  <Icon name="userPlus" size={18} />{creating ? 'Creando cuenta...' : 'Crear cuenta'}
                </button>
              </fieldset>
            </form>
          </section>

          <section aria-labelledby="user-list" className="surface min-w-0 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="user-list" className="font-serif text-2xl">Cuentas creadas</h2>
              <div role="group" aria-label="Filtrar por tipo de cuenta" className="flex flex-wrap gap-2">
                {(['ALL', 'PSYCHOLOGIST', 'STAFF'] as const).map((value) => (
                  <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
                    className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition ${filter === value ? 'border-forest bg-forest text-white' : 'border-border bg-paper text-ink-soft hover:border-forest hover:text-forest'}`}>
                    {value === 'ALL' ? 'Todos' : value === 'PSYCHOLOGIST' ? 'Psicólogos' : 'Staff'} · {counts[value]}{more}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <p role="status" className="mt-4 text-sm text-muted-foreground">Cargando usuarios...</p>
            ) : visible.length === 0 ? (
              <div className="mt-4">
                <EmptyState icon="users" title="Sin cuentas todavía" text={filter === 'ALL' ? 'Crea la primera cuenta de psicólogo o staff con el formulario.' : 'No hay cuentas de este tipo en la lista cargada.'} />
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {visible.map((user) => (
                  <li key={user.id} className={`rounded-2xl border p-4 ${user.isActive ? 'border-[rgba(54,91,69,0.15)] bg-background/60' : 'border-border bg-muted/40'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <p className="flex items-center gap-2 break-words font-semibold"><Icon name="profile" size={17} className="shrink-0 text-primary" />{user.fullName?.trim() || 'Sin nombre'}</p>
                        <p className="break-all text-sm text-ink-soft">{user.email}</p>
                        <p className="text-xs text-ink-soft">
                          {[user.position, user.phone, `Creada el ${formatDate(user.createdAt)}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill tone={ROLE_TONE[user.role]}>{INTERNAL_ROLE_LABEL[user.role]}</StatusPill>
                        <StatusPill tone={user.isActive ? 'green' : 'gray'}>{user.isActive ? 'Activa' : 'Inactiva'}</StatusPill>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {hasMore && !loading && (
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn btn-quiet mt-4">
                {loadingMore ? 'Cargando...' : 'Cargar más usuarios'}
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
