'use client';

import { CareAlertsView } from '../../../components/care-alerts-view';
import { getMyCareAlerts, type CareAlert } from '../../../lib/api';

function patientHref(alert: CareAlert) {
  return `/psychologist/patients/${encodeURIComponent(alert.patient.id)}`;
}

export default function PsychologistAlertsPage() {
  return <CareAlertsView load={getMyCareAlerts} showPsychologist={false} patientHref={patientHref} />;
}
