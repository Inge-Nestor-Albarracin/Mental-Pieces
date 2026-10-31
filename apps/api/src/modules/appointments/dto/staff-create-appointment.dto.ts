import { IsString, Matches, MaxLength } from 'class-validator';

import { CreateAppointmentDto } from './create-appointment.dto';

// Booking made by reception for an existing patient (Patient.id, not the user id).
export class StaffCreateAppointmentDto extends CreateAppointmentDto {
  @IsString()
  @MaxLength(30)
  @Matches(/^c[a-z0-9]{24,29}$/, {
    message: 'Identificador de paciente no válido.',
  })
  patientId!: string;
}
