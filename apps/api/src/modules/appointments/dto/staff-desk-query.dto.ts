import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class StaffPatientSearchDto {
  @Transform(trim)
  @IsString({
    message: 'Escribe un nombre, documento interno, correo o teléfono.',
  })
  @MinLength(2, { message: 'Escribe al menos 2 caracteres para buscar.' })
  @MaxLength(80, { message: 'La búsqueda es demasiado larga.' })
  search!: string;
}

export class StaffAgendaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  days: number = 14;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^c[a-z0-9]{24,29}$/, {
    message: 'Identificador de psicólogo no válido.',
  })
  psychologistId?: string;
}
