'use client';

import { useEffect, useState } from 'react';
import { getPushConfig, sendTestPush } from '../lib/api';
import {
  dismissPrompt,
  enablePush,
  hasServiceWorker,
  isPromptDismissed,
  pushSupport,
  syncPushSubscription,
} from '../lib/push';
import { Icon } from './ui';

type PromptState =
  | { kind: 'hidden' }
  | { kind: 'ask' }
  | { kind: 'needs-install' }
  | { kind: 'denied' }
  | { kind: 'enabled' };

// Shown at the top of every portal (patient, psychologist, admin, staff). Asks for
// permission only when the person clicks: browsers block prompts without a gesture.
export function PushPrompt() {
  const [state, setState] = useState<PromptState>({ kind: 'hidden' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function check() {
      const token = sessionStorage.getItem('accessToken');
      if (!token) return;
      const support = pushSupport();
      if (support === 'needs-install') {
        if (active && !isPromptDismissed()) setState({ kind: 'needs-install' });
        return;
      }
      if (support !== 'supported' || !(await hasServiceWorker())) return;
      const config = await getPushConfig(token).catch(() => null);
      if (!active || !config?.enabled || !config.publicKey) return;
      if (Notification.permission === 'granted') {
        // Already allowed on this device: keep it linked to the signed-in account.
        await syncPushSubscription(token, config.publicKey).catch(() => false);
        return;
      }
      if (Notification.permission === 'default' && !isPromptDismissed()) setState({ kind: 'ask' });
    }
    void check();
    return () => { active = false; };
  }, []);

  async function enable() {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      const permission = await enablePush(token);
      if (permission === 'granted') {
        setState({ kind: 'enabled' });
        const result = await sendTestPush(token).catch(() => null);
        setMessage(result && result.delivered > 0
          ? 'Listo. Te enviamos una notificación de prueba.'
          : 'Notificaciones activadas en este dispositivo.');
      } else if (permission === 'denied') {
        setState({ kind: 'denied' });
      } else {
        dismiss();
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'No fue posible activar las notificaciones.');
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    dismissPrompt();
    setState({ kind: 'hidden' });
  }

  if (state.kind === 'hidden') return null;

  const tone = state.kind === 'enabled' ? 'border-[#c9dacb] bg-mint text-forest-deep' : 'border-[rgba(54,91,69,0.18)] bg-paper text-foreground';

  return (
    <section aria-live="polite" aria-label="Notificaciones" className={`mb-5 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${tone}`}>
      <span className="icon-box shrink-0"><Icon name="bell" size={21} /></span>
      <div className="min-w-0 flex-1 text-sm">
        {state.kind === 'ask' && (
          <>
            <strong className="block text-base">Activa las notificaciones</strong>
            Recibe en este dispositivo los avisos de tus citas: confirmaciones, cambios, cancelaciones y recordatorios.
          </>
        )}
        {state.kind === 'needs-install' && (
          <>
            <strong className="block text-base">Recibe notificaciones en tu iPhone o iPad</strong>
            Instala la app: en Safari toca <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>. Ábrela desde allí para activar los avisos.
          </>
        )}
        {state.kind === 'denied' && (
          <>
            <strong className="block text-base">Las notificaciones están bloqueadas</strong>
            Puedes permitirlas desde la configuración del sitio en tu navegador (icono junto a la dirección).
          </>
        )}
        {state.kind === 'enabled' && <strong className="block text-base">{message || 'Notificaciones activadas.'}</strong>}
        {state.kind !== 'enabled' && message && <p role="alert" className="mt-1 text-red-800">{message}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {state.kind === 'ask' && (
          <button type="button" onClick={() => void enable()} disabled={busy} className="btn btn-primary">
            {busy ? 'Activando...' : 'Activar'}
          </button>
        )}
        <button type="button" onClick={dismiss} className="btn btn-quiet" aria-label="Cerrar aviso de notificaciones">
          {state.kind === 'ask' ? 'Ahora no' : 'Cerrar'}
        </button>
      </div>
    </section>
  );
}
