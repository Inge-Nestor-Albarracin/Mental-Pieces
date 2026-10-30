import { Transform } from 'class-transformer';
import {
  IsEnum,
  Matches,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Gender } from '../../../../generated/prisma/client';

// Text fields are validated after trimming: only spaces never pass as a value.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateMyProfileDto {
  @IsOptional()
  @Transform(trim)
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

  // Calendar date YYYY-MM-DD (existence and "not in the future" checked in the service).
  @IsOptional()
  @IsString({ message: 'La fecha de nacimiento no es válida.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de nacimiento no es válida.',
  })
  birthDate?: string;

  @IsOptional()
  @IsEnum(Gender, {
    message: 'El género seleccionado no es válido.',
  })
  gender?: Gender;

  @IsOptional()
  @Transform(trim)
  @IsString({
    message: 'El género especificado debe ser un texto.',
  })
  @MaxLength(80)
  genderOther?: string;

  @IsOptional()
  @Transform(trim)
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
