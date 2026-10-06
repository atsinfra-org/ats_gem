import { OmitType } from '@nestjs/swagger';
import { ListTendersQueryDto } from '../../tenders/dto/list-tenders.query.dto';

/**
 * A saved search captures exactly the search model of `GET /search/tenders` (same fields, validators and
 * normalization), minus paging. Phase 2-6 criteria (`q`, single `state`/`category`/`status`, date bounds)
 * remain valid: list fields accept a single value or a list, and stored legacy rows keep working because
 * readers treat a string as a one-element list. Saving a search never creates a notification.
 */
export class SavedSearchCriteriaDto extends OmitType(ListTendersQueryDto, ['page', 'pageSize', 'sortBy', 'sortOrder'] as const) {}
