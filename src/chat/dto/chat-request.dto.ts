import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class LocationDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;
}

/** Cuerpo de POST /chat. */
export class ChatRequestDto {
  /** Lo que el usuario acaba de escribir. */
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;

  /** Mensajes anteriores de la conversación (la app los guarda y los reenvía). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];

  /** Ubicación del usuario, si dio permiso: activa recomendaciones cercanas. */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  /** Nombre para personalizar el saludo. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  userName?: string;
}
