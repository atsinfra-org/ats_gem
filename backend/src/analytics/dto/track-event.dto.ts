import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsEnum, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { AnalyticsEventName } from '../../generated/prisma/enums';

/** `anonymousId`: a client-generated random id (not derived from any PII), 8-64 opaque characters. */
const ANONYMOUS_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class TrackEventDto {
  @ApiProperty({ enum: AnalyticsEventName })
  @IsEnum(AnalyticsEventName)
  name!: AnalyticsEventName;

  @ApiProperty({ description: 'Client-generated anonymous id (never an email, name or token).' })
  @IsString()
  @Matches(ANONYMOUS_ID)
  anonymousId!: string;

  @ApiPropertyOptional({ description: 'Pathname only - no query string, no origin.' })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  path?: string;

  @ApiPropertyOptional({ description: 'Event-specific, schema-validated per `name` (see analytics-event-schemas.ts).' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Entity kind for entity-scoped events, e.g. "tender".' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  entityType?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;

  @ApiPropertyOptional({ description: "Client's local time when the event happened; clamped server-side." })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  // First-touch session attribution, sent only by the first event of a new session.
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 300) landingPath?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) referrerHost?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) utmSource?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) utmMedium?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) utmCampaign?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) utmTerm?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) utmContent?: string;
}

export class TrackEventsDto {
  @ApiProperty({ type: [TrackEventDto], description: 'At most 20 events per request (ANALYTICS_MAX_BATCH_SIZE).' })
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  events!: TrackEventDto[];
}
