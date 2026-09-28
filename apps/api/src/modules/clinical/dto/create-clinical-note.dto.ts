import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateClinicalNoteDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'El contenido debe ser texto.' })
  @MinLength(1, { message: 'El contenido no puede estar vacío.' })
  @MaxLength(10000, {
    message: 'El contenido no puede superar 10000 caracteres.',
  })
  content!: string;

  // Omitted is allowed; explicit null, empty strings and non-CUID values are not.
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^c[a-z0-9]{24,29}$/, {
    message: 'Identificador de cita no válido.',
  })
  appointmentId?: string;
}
