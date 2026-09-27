import {
  IsString,
  Matches,
} from 'class-validator';

export class RescheduleAppointmentDto {
  @IsString()
  @Matches(
    /^\d{4}-\d{2}-\d{2}$/,
    {
      message:
        'La fecha debe tener formato YYYY-MM-DD.',
    },
  )
  appointmentDate!: string;

  @IsString()
  @Matches(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    {
      message:
        'La hora debe tener formato HH:mm.',
    },
  )
  startTime!: string;
}
