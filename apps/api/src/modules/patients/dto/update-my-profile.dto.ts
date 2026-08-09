import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Gender } from '../../../../generated/prisma/client';

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString({
    message: 'El nombre debe ser un texto.',
  })
  @MinLength(2, {
    message: 'El nombre debe tener al menos 2 caracteres.',
  })
  @MaxLength(120, {
    message: 'El nombre no puede superar los 120 caracteres.',
  })
  fullName?: string;

  @IsOptional()
  @IsDateString(
    {},
    {
      message: 'La fecha de nacimiento no es válida.',
    },
  )
  birthDate?: string;

  @IsOptional()
  @IsEnum(Gender, {
    message: 'El género seleccionado no es válido.',
  })
  gender?: Gender;

  @IsOptional()
  @IsString({
    message: 'El género especificado debe ser un texto.',
  })
  @MaxLength(80)
  genderOther?: string;

  @IsOptional()
  @IsString({
    message: 'El teléfono debe ser un texto.',
  })
  @MinLength(7, {
    message: 'El teléfono es demasiado corto.',
  })
  @MaxLength(25, {
    message: 'El teléfono es demasiado largo.',
  })
  phone?: string;
}