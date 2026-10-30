import { Equals, IsString, MaxLength, MinLength } from 'class-validator';

// Explicit acceptance of the published data-processing policy. The server checks
// the version and records the time; the client never sends a date or a status.
export class AcceptDataPolicyDto {
  @Equals(true, {
    message:
      'Debes aceptar la Política de Tratamiento de Datos Personales para continuar.',
  })
  acceptDataPolicy!: boolean;

  @IsString({ message: 'Indica la versión de la política que aceptas.' })
  @MinLength(1, { message: 'Indica la versión de la política que aceptas.' })
  @MaxLength(40)
  dataPolicyVersion!: string;
}
