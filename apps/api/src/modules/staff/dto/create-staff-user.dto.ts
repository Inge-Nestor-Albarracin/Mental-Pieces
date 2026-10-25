import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserRole } from '../../../../generated/prisma/client';

// Trim before validating, so a name made of spaces is rejected.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateStaffUserDto {
  @Transform(trim)
  @IsEmail(
    {},
    {
      message:
        'El correo electrónico no es válido.',
    },
  )
  email!: string;

  @IsString({
    message:
      'La contraseña debe ser un texto.',
  })
  @MinLength(8, {
    message:
      'La contraseña debe tener al menos 8 caracteres.',
  })
  @MaxLength(72, {
    message:
      'La contraseña no puede superar los 72 caracteres.',
  })
  password!: string;

  @Transform(trim)
  @IsString({
    message:
      'El nombre debe ser un texto.',
  })
  @MinLength(2, {
    message:
      'El nombre debe tener al menos 2 caracteres.',
  })
  @MaxLength(120, {
    message:
      'El nombre no puede superar los 120 caracteres.',
  })
  fullName!: string;

  @IsIn(
    [
      UserRole.STAFF,
      UserRole.PSYCHOLOGIST,
    ],
    {
      message:
        'El rol debe ser STAFF o PSYCHOLOGIST.',
    },
  )
  role!: UserRole;

  @Transform(trim)
  @IsOptional()
  @IsString({
    message:
      'El teléfono debe ser un texto.',
  })
  @MinLength(7, {
    message:
      'El teléfono es demasiado corto.',
  })
  @MaxLength(25, {
    message:
      'El teléfono es demasiado largo.',
  })
  phone?: string;

  @Transform(trim)
  @IsOptional()
  @IsString({
    message:
      'El cargo debe ser un texto.',
  })
  @MaxLength(100, {
    message:
      'El cargo no puede superar los 100 caracteres.',
  })
  position?: string;
}