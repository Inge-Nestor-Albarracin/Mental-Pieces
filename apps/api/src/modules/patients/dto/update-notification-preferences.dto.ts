import { IsBoolean } from 'class-validator';

// Explicit choice made by the patient. There is no default "true" anywhere.
export class UpdateNotificationPreferencesDto {
  @IsBoolean({ message: 'emailReminders debe ser verdadero o falso.' })
  emailReminders!: boolean;
}
