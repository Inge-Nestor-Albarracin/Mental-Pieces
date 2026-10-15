'use client';

import { CareAlertsView } from '../../../components/care-alerts-view';
import { getAdminCareAlerts } from '../../../lib/api';

// ADMIN sees who needs follow-up, never clinical content: no link into the clinical view.
export default function AdminAlertsPage() {
  return <CareAlertsView load={getAdminCareAlerts} showPsychologist />;
}
