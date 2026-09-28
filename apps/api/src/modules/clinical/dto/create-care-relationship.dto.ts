import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateCareRelationshipDto {
  @IsString()
  @MaxLength(30)
  @Matches(/^c[a-z0-9]{24,29}$/, {
    message: 'Identificador de paciente no válido.',
  })
  patientId!: string;

  @IsString()
  @MaxLength(30)
  @Matches(/^c[a-z0-9]{24,29}$/, {
    message: 'Identificador de psicólogo no válido.',
  })
  psychologistId!: string;
}
