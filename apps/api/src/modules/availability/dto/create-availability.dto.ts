import {
  IsEnum,
  IsString,
  Matches,
} from 'class-validator';

import {
  WeekDay,
} from '../../../../generated/prisma/client';

export class CreateAvailabilityDto {
  @IsEnum(WeekDay, {
    message:
      'El día de la semana no es válido.',
  })
  dayOfWeek!: WeekDay;

  @IsString()
  @Matches(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    {
      message:
        'La hora de inicio debe tener formato HH:mm.',
    },
  )
  startTime!: string;

  @IsString()
  @Matches(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    {
      message:
        'La hora de finalización debe tener formato HH:mm.',
    },
  )
  endTime!: string;
}