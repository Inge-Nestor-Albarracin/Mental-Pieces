import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { AcceptDataPolicyDto } from '../../legal/dto/accept-data-policy.dto';

// Stage 1 of the patient sign-up: account credentials plus the explicit acceptance
// of the published data-processing policy. Personal data comes later (profile).
export class CreatePatientUserDto extends AcceptDataPolicyDto {
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  email!: string;

  @IsString({ message: 'La contraseña debe ser un texto.' })
  @MinLength(8, {
    message: 'La contraseña debe tener al menos 8 caracteres.',
  })
  @MaxLength(72, {
    message: 'La contraseña no puede superar los 72 caracteres.',
  })
  password!: string;
}