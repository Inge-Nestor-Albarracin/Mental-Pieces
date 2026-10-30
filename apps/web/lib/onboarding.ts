// Where a signed-in patient must go before using the portal. Pure: shared by the
// login page and the patient gate, and unit-tested. Navigation only — the API
// enforces the same rules (booking returns 409 until both steps are done).

export const DATA_POLICY_PATH = '/politica-de-tratamiento-de-datos';
export const CONSENT_PATH = '/autorizacion-de-datos';
export const PROFILE_EDIT_PATH = '/profile/edit';
export const ONBOARDING_PROFILE_URL = '/profile/edit?onboarding=1';
export const PATIENT_HOME = '/dashboard';

export interface PatientStatus {
  dataPolicyAccepted: boolean;
  isProfileComplete: boolean;
}

// First the authorisation, then the profile, then the portal.
export function patientLanding(status: PatientStatus): string {
  if (!status.dataPolicyAccepted) return CONSENT_PATH;
  if (!status.isProfileComplete) return ONBOARDING_PROFILE_URL;
  return PATIENT_HOME;
}

// null = stay on this page. Every target is a page that the same status allows,
// so following the redirect can never bounce back (no loops).
export function patientRedirect(pathname: string, status: PatientStatus): string | null {
  if (!status.dataPolicyAccepted) return pathname === CONSENT_PATH ? null : CONSENT_PATH;
  if (!status.isProfileComplete) return pathname === PROFILE_EDIT_PATH ? null : ONBOARDING_PROFILE_URL;
  if (pathname === CONSENT_PATH) return PATIENT_HOME;
  return null;
}
